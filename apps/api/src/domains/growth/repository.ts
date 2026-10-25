import {
  currentVersion,
  type LpViewRequest,
  normalizeLandingPath,
  normalizeUtm,
  PRE_REGISTRATION_RETENTION_DAYS,
  type PreRegistrationRequest,
} from "@app/shared";
import { and, eq, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import { enqueue } from "../../outbox/index.ts";
import { idOfLinkToken, verifyLinkToken } from "./links.ts";
import { lpDailyCounts, preRegistrations } from "./schema.ts";

// 事前登録と日ごとの数の読み書き(設計書 0025 の 2・4・6)。どれも運営の組織の文脈(withTenant)の中で呼ぶ。
// 公開の入口は利用者がいないので TenantScope ではなく「トランザクションと運営の組織の ID」を受ける。

export type PublicScope = { tx: TenantTx; tenantId: string };

const DAY = 86_400_000;
/** 確認のメールを同じアドレスへ送り直してよい間隔 */
export const CONFIRM_RESEND_MS = DAY;
/** 確認のリンクの期限(確認待ちの登録が消えるまでと同じ) */
export const CONFIRM_LINK_MS = PRE_REGISTRATION_RETENTION_DAYS.pending * DAY;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysAfter = (d: Date, days: number) => isoDate(new Date(d.getTime() + days * DAY));
/** 日本時間の日付(日ごとの数の区切り) */
export const tokyoDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);

type Source = { path: string; utmSource: string; utmMedium: string; utmCampaign: string };
type Counter = "views" | "registrations" | "confirmations";

/** 日ごとの数に1足す(無ければ行を作る) */
async function bump(scope: PublicScope, source: Source, counter: Counter, now: Date) {
  const row = { tenantId: scope.tenantId, day: tokyoDay(now), ...source, [counter]: 1 };
  await scope.tx
    .insert(lpDailyCounts)
    .values(row)
    .onConflictDoUpdate({
      target: [
        lpDailyCounts.tenantId,
        lpDailyCounts.day,
        lpDailyCounts.path,
        lpDailyCounts.utmSource,
        lpDailyCounts.utmMedium,
        lpDailyCounts.utmCampaign,
      ],
      set: { [counter]: sql`${lpDailyCounts[counter]} + 1` },
    });
}

const sourceOf = (input: {
  path?: string | undefined;
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
}): Source => ({
  path: normalizeLandingPath(input.path),
  utmSource: normalizeUtm(input.utmSource),
  utmMedium: normalizeUtm(input.utmMedium),
  utmCampaign: normalizeUtm(input.utmCampaign),
});

/** 公開のページが開かれた(見た数に1足す) */
export async function countView(scope: PublicScope, input: LpViewRequest, now = new Date()) {
  await bump(scope, sourceOf(input), "views", now);
}

export type RegisterResult = "created" | "resent" | "unchanged";

/**
 * 事前登録を受ける。同じアドレスがもうあれば行を作らず、確認待ちで24時間たっていれば確認のメールを送り直す。
 * どの場合も、呼んだ側は同じ答えを返す(登録の有無を漏らさない)。
 */
export async function registerPreRegistration(
  scope: PublicScope,
  input: PreRegistrationRequest,
  now = new Date(),
): Promise<RegisterResult> {
  const source = sourceOf({ ...input, path: input.landingPath });
  const email = input.email.toLowerCase();
  const inserted = await scope.tx
    .insert(preRegistrations)
    .values({
      tenantId: scope.tenantId,
      email,
      organizationName: input.organizationName,
      companySize: input.companySize ?? "",
      utmSource: source.utmSource,
      utmMedium: source.utmMedium,
      utmCampaign: source.utmCampaign,
      landingPath: source.path,
      consentTextVersion: input.consentTextVersion,
      privacyVersion: currentVersion("privacy", now)?.version ?? null,
      consentedAt: now,
      confirmSentAt: now,
      deleteAfter: daysAfter(now, PRE_REGISTRATION_RETENTION_DAYS.pending),
      createdAt: now,
    })
    .onConflictDoNothing({ target: [preRegistrations.tenantId, preRegistrations.email] })
    .returning({ id: preRegistrations.id });
  const created = inserted[0];
  if (created) {
    await bump(scope, source, "registrations", now);
    await enqueueConfirmMail(scope, created.id);
    return "created";
  }
  const resend = await scope.tx
    .update(preRegistrations)
    .set({ confirmSentAt: now })
    .where(
      and(
        eq(preRegistrations.tenantId, scope.tenantId),
        eq(preRegistrations.email, email),
        eq(preRegistrations.status, "pending"),
        sql`${preRegistrations.confirmSentAt} <= ${new Date(now.getTime() - CONFIRM_RESEND_MS)}`,
      ),
    )
    .returning({ id: preRegistrations.id });
  const row = resend[0];
  if (!row) return "unchanged";
  await enqueueConfirmMail(scope, row.id);
  return "resent";
}

const enqueueConfirmMail = (scope: PublicScope, preRegistrationId: string) =>
  // 公開の入口に利用者はいない(出来事の中身は登録の ID だけ。宛先は送る直前に読む)
  enqueue({ ...scope, userId: "" }, "growth.pre_registration_received", { preRegistrationId });

async function findById(scope: PublicScope, id: string) {
  const [row] = await scope.tx
    .select()
    .from(preRegistrations)
    .where(and(eq(preRegistrations.tenantId, scope.tenantId), eq(preRegistrations.id, id)));
  return row;
}

/**
 * 確認のリンクを開いた。期限の内で署名が合えば confirmed にして、消す日を延ばす。
 * もう確認済み・組織にした登録は、何もせずに true(2回押しても困らない)。
 */
export async function confirmPreRegistration(
  scope: PublicScope,
  key: Buffer,
  token: string,
  now = new Date(),
): Promise<boolean> {
  const id = idOfLinkToken(token);
  const row = id ? await findById(scope, id) : undefined;
  if (!row || !verifyLinkToken(key, "confirm", token, row.id, row.confirmSentAt)) return false;
  if (row.status !== "pending") return true;
  if (now.getTime() - row.confirmSentAt.getTime() > CONFIRM_LINK_MS) return false;
  await scope.tx
    .update(preRegistrations)
    .set({
      status: "confirmed",
      confirmedAt: now,
      deleteAfter: daysAfter(row.createdAt, PRE_REGISTRATION_RETENTION_DAYS.confirmed),
    })
    .where(and(eq(preRegistrations.tenantId, scope.tenantId), eq(preRegistrations.id, row.id)));
  await bump(
    scope,
    {
      path: row.landingPath,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
    },
    "confirmations",
    now,
  );
  return true;
}

/** 取り消しのリンク。署名が合えば行を消す。無い・合わないときも同じ答え(呼んだ側は何も言わない) */
export async function withdrawPreRegistration(
  scope: PublicScope,
  key: Buffer,
  token: string,
): Promise<boolean> {
  const id = idOfLinkToken(token);
  const row = id ? await findById(scope, id) : undefined;
  if (!row || !verifyLinkToken(key, "withdraw", token, row.id, row.createdAt)) return false;
  await scope.tx
    .delete(preRegistrations)
    .where(and(eq(preRegistrations.tenantId, scope.tenantId), eq(preRegistrations.id, row.id)));
  return true;
}

/** 確認のメールを組み立てるのに要る物(アウトボックスの受け手が送る直前に読む) */
export async function findForConfirmMail(scope: PublicScope, id: string) {
  const row = await findById(scope, id);
  if (!row) return undefined;
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    confirmSentAt: row.confirmSentAt,
    createdAt: row.createdAt,
  };
}
