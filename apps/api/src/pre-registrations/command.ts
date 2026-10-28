import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  countsBySource,
  deleteByEmail,
  findByEmail,
  type PublicScope,
  purgeExpired,
  type SourceCounts,
  tokyoDay,
} from "../domains/growth/index.ts";

// 運営のコマンド pre-registrations-report・pre-registrations-find・pre-registrations-purge・pre-registrations-delete(cli.ts)の中身
// (docs/runbooks/pre-registrations.md)。接続は表の持ち主。表は FORCE RLS なので、運営の組織の文脈を付けて読み書きする
// (文脈を開くので領域の外に置く。読み書きの中身は domains/growth の operator.ts)。
// **メールアドレス・会社名は外に出さない**(出すのは数と率だけ。AI に渡してよいのもここまで。docs/security.md の AI-6)。

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const rate = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 10);

export type SourceRow = SourceCounts & {
  /** 登録 ÷ 見た数(%。見た数が 0 なら null) */
  registrationRate: number | null;
  /** 確認 ÷ 登録(%) */
  confirmationRate: number | null;
};

const inOperatorTenant = <T>(
  db: RootDb,
  operatorTenantId: string,
  fn: (scope: PublicScope) => Promise<T>,
) => withTenant(db, operatorTenantId, (tx) => fn({ tx, tenantId: operatorTenantId }));

const withRates = (r: SourceCounts): SourceRow => ({
  ...r,
  registrationRate: rate(r.registrations, r.views),
  confirmationRate: rate(r.confirmations, r.registrations),
});

/** 来た所(UTM)ごとの見た数・登録・確認と率。期間は日本時間の日付(両端を含む) */
export async function preRegistrationReport(
  db: RootDb,
  operatorTenantId: string,
  range: { from: string; to: string },
): Promise<{ from: string; to: string; total: SourceRow; sources: SourceRow[] }> {
  const rows = await inOperatorTenant(db, operatorTenantId, (scope) =>
    countsBySource(scope, range),
  );
  const sources = rows
    .map(withRates)
    .sort((a, b) => b.registrations - a.registrations || b.views - a.views);
  const sum = (k: "views" | "registrations" | "confirmations") =>
    rows.reduce((n, r) => n + r[k], 0);
  const total = withRates({
    utmSource: "(全部)",
    utmMedium: "",
    utmCampaign: "",
    views: sum("views"),
    registrations: sum("registrations"),
    confirmations: sum("confirmations"),
  });
  return { ...range, total, sources };
}

/** pre-registrations-report [--from YYYY-MM-DD] [--to YYYY-MM-DD](既定は今日までの28日) */
export function parseReportArgs(args: string[], now = new Date()): { from: string; to: string } {
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  // 日ごとの数は日本時間の日付で数えている(tokyoDay)。既定の終わりも日本時間の今日にする
  // (UTC の日付にすると、日本時間の 0〜9時は「今日」の数が入らない)
  const to = value("--to") ?? tokyoDay(now);
  const from = value("--from") ?? isoDate(new Date(Date.parse(to) - 27 * DAY));
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    throw new Error("使い方: pre-registrations-report [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
  }
  return { from, to };
}

// ── コマンドの入口(cli.ts)。引数を読み、出す行(JSON 1行+案内)を返す。接続を開く・閉じるのは cli.ts ──

export async function runReport(db: RootDb, operatorTenantId: string, args: string[]) {
  const report = await preRegistrationReport(db, operatorTenantId, parseReportArgs(args));
  return [JSON.stringify({ mode: "report", ...report })];
}

export async function runPurge(db: RootDb, operatorTenantId: string, args: string[]) {
  const execute = args.includes("--execute");
  const r = await inOperatorTenant(db, operatorTenantId, (scope) =>
    purgeExpired(scope, { execute, now: new Date() }),
  );
  const lines = [JSON.stringify({ mode: execute ? "purged" : "plan", ...r })];
  if (!execute) lines.push("まだ消していません。数を確かめて --execute を付けて流してください");
  return lines;
}

export async function runDelete(
  db: RootDb,
  operatorTenantId: string,
  email: string,
  args: string[],
) {
  if (!email.includes("@")) throw new Error("メールアドレスを1行で入れてください");
  const execute = args.includes("--execute");
  const r = await inOperatorTenant(db, operatorTenantId, (scope) =>
    deleteByEmail(scope, email, { execute }),
  );
  const lines = [JSON.stringify({ mode: execute ? "deleted" : "plan", ...r })];
  if (!execute && r.found > 0) {
    lines.push("まだ消していません。--execute を付けて、もう一度アドレスを入れてください");
  }
  return lines;
}

/** 状態ごとの次の一歩(開通の手順書 tenant-provisioning.md の「事前登録から」) */
const FIND_NEXT: Record<string, string> = {
  pending:
    "確認待ちです(組織にはできません)。本人に確認のメールを開いてもらってから、もう一度探してください",
  confirmed: "確認済みです。この preRegistrationId を開通の作業に渡してください",
  converted: "もう組織にしました(convertedTenantId)。同じ登録から2つ目の組織を作らないでください",
};

export async function runFind(db: RootDb, operatorTenantId: string, email: string) {
  if (!email.includes("@")) throw new Error("メールアドレスを1行で入れてください");
  const found = await inOperatorTenant(db, operatorTenantId, (scope) => findByEmail(scope, email));
  if (!found) {
    return [
      JSON.stringify({ mode: "find", found: 0 }),
      "見つかりません。アドレスの打ち間違い・本人が取り消した・期限で消えた(確認待ちは7日)のどれかです",
    ];
  }
  // 確認待ちの ID は開通に使えないので出さない(出すのは状態だけ)
  const { preRegistrationId, ...rest } = found;
  const shown = found.status === "pending" ? rest : { preRegistrationId, ...rest };
  return [
    JSON.stringify({ mode: "find", found: 1, ...shown }),
    FIND_NEXT[found.status] ?? "",
  ].filter(Boolean);
}
