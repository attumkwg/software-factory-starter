import { sql } from "drizzle-orm";
import type { RootDb, TenantTx } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";

// 利用者1人分の開示・削除の「試し」(docs/specs/0048-person-data.md・ADR 0059)。
// 手順は docs/runbooks/person-data.md。**数えるだけで、何も変えない**(消す・匿名化するのは次の一歩)。
//
//   node dist/cli.js person-data <組織の ID> <利用者の ID>
//
// 引数は ID だけ(名前・メールを ECS の引数 = CloudTrail に残さない)。利用者の ID は、お客さんの管理者が
// データの書き出し(users の id)で見つけて、運営に渡す(お客さんが委託元・自社は委託先。docs/legal/data-processing.md)。
// 出すのは表と列の名前・件数・扱いだけ(値は出さない)。接続は表の持ち主(移行と同じ)で、組織の文脈を付けて読む。

/**
 * 消すときの扱い(案。設計書 0048 の U-2)。
 * anonymize … 行は残し、名前・メールなどの値だけを置き換える(ほかの行が指しているため)
 * delete    … 行ごと消す(その人だけの記録)
 * keep      … 残す(人の ID だけが残る。業務・監査・同意の証拠。値は持たない)
 */
export type PersonAction = "anonymize" | "delete" | "keep";

export type PersonReference = {
  /** スキーマ.表 */
  table: string;
  /** 利用者を指す列(ID か、メールアドレス) */
  column: string;
  /** その列が何で指すか */
  by: "user_id" | "email" | "payload";
  action: PersonAction;
  /** なぜその扱いか(一言) */
  why: string;
};

/**
 * 利用者を指している列の一覧。**利用者の ID を持つ列(…_by・…user_id・actor_id)を足したら、ここにも足す**
 * (無ければ結合テスト person-data.int.test.ts が落ちる)。順は表の名前。
 */
export const PERSON_REFERENCES: readonly PersonReference[] = [
  {
    table: "legal.consents",
    column: "user_id",
    by: "user_id",
    action: "keep",
    why: "同意した証拠(規約の争いに備える)",
  },
  {
    table: "legal.notices",
    column: "user_id",
    by: "user_id",
    action: "delete",
    why: "お知らせを送った記録だけ",
  },
  {
    table: "organizations.email_changes",
    column: "user_id",
    by: "user_id",
    action: "delete",
    why: "本人のメールの変更の申し込み(古い・新しいメールが入る)",
  },
  {
    table: "organizations.invitations",
    column: "accepted_user_id",
    by: "user_id",
    action: "anonymize",
    why: "招待を受けた記録(招待のメールを置き換える)",
  },
  {
    table: "organizations.invitations",
    column: "email",
    by: "email",
    action: "anonymize",
    why: "その人のメールで招いた記録(受けていない物も)",
  },
  {
    table: "organizations.invitations",
    column: "invited_by",
    by: "user_id",
    action: "keep",
    why: "誰が招いたか(人の ID だけ)",
  },
  {
    table: "organizations.invitations",
    column: "revoked_by",
    by: "user_id",
    action: "keep",
    why: "誰が取り消したか(人の ID だけ)",
  },
  {
    table: "organizations.domains",
    column: "created_by",
    by: "user_id",
    action: "keep",
    why: "誰が会社のドメインを登録したか(人の ID だけ)",
  },
  {
    table: "organizations.ip_allowlist",
    column: "created_by",
    by: "user_id",
    action: "keep",
    why: "誰が IP の範囲を足したか(人の ID だけ)",
  },
  {
    table: "organizations.support_grants",
    column: "granted_by",
    by: "user_id",
    action: "keep",
    why: "誰がサポートを許可したか(監査)",
  },
  {
    table: "organizations.support_grants",
    column: "revoked_by",
    by: "user_id",
    action: "keep",
    why: "誰が取り消したか(監査)",
  },
  {
    table: "organizations.support_sessions",
    column: "staff_user_id",
    by: "user_id",
    action: "keep",
    why: "運営の社員の入室(社員の名前とメールの写しは、社員が辞めたときに別に扱う)",
  },
  {
    table: "organizations.users",
    column: "id",
    by: "user_id",
    action: "anonymize",
    why: "本人の行(ほかの行が指すので残し、名前・メール・Cognito の結びつきを消す)",
  },
  {
    table: "platform.audit_events",
    column: "actor_id",
    by: "user_id",
    action: "keep",
    why: "誰が何をしたか(監査ログは直さない。値は入っていない)",
  },
  {
    table: "platform.feature_usage",
    column: "user_id",
    by: "user_id",
    action: "delete",
    why: "機能を使った日の記録(400日で消える物)",
  },
  {
    table: "platform.pmf_survey_asked",
    column: "user_id",
    by: "user_id",
    action: "delete",
    why: "「無くなったら困るか」をこの回に答え終えた印(答えは持たない。400日で消える物)",
  },
  {
    table: "platform.outbox",
    column: "payload",
    by: "payload",
    action: "delete",
    why: "本人へのお知らせの送信待ち(中身は ID だけ。送った物も残っている)",
  },
  {
    table: "projects.projects",
    column: "created_by",
    by: "user_id",
    action: "keep",
    why: "誰が作ったか(業務のデータはお客さんの物)",
  },
];

export type PersonDataLine = PersonReference & { rows: number };

export type PersonDataPlan = {
  tenantId: string;
  userId: string;
  /** その組織にその人(users の行)がいるか。いなければ数えない */
  found: boolean;
  /** Cognito の利用者(sub)。結びついていなければ null(消すときは Cognito からも消す) */
  cognitoSub: string | null;
  /** 1件以上ある所だけ */
  lines: PersonDataLine[];
  totals: Record<PersonAction, number>;
};

const table = (name: string) => {
  const [schema, rel] = name.split(".");
  return sql`${sql.identifier(schema as string)}.${sql.identifier(rel as string)}`;
};

/** 1つの列で、その人を指している行の数(組織の文脈と、組織の ID でも絞る) */
async function countRows(
  tx: TenantTx,
  ref: PersonReference,
  who: { tenantId: string; userId: string; email: string },
): Promise<number> {
  const col = sql.identifier(ref.column);
  const match =
    ref.by === "email"
      ? sql`${col} = ${who.email}`
      : ref.by === "payload"
        ? sql`(${col}->>'userId' = ${who.userId} or ${col}->>'completedBy' = ${who.userId})`
        : sql`${col} = ${who.userId}`;
  const r = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${table(ref.table)} where tenant_id = ${who.tenantId} and ${match}`,
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * 利用者1人分が、どの表のどの列に何件あるかと、消すときの扱い(案)を数える。何も変えない。
 * その組織にその人がいなければ found: false(ほかの組織の人かどうかは言わない)。
 */
export async function planPersonData(
  db: RootDb,
  tenantId: string,
  userId: string,
): Promise<PersonDataPlan> {
  return withTenant(db, tenantId, async (tx) => {
    const totals: Record<PersonAction, number> = { anonymize: 0, delete: 0, keep: 0 };
    const user = await tx.execute<{ email: string; external_id: string | null }>(
      sql`select email, external_id from organizations.users where tenant_id = ${tenantId} and id = ${userId}`,
    );
    const row = user.rows[0];
    if (!row) return { tenantId, userId, found: false, cognitoSub: null, lines: [], totals };
    const who = { tenantId, userId, email: row.email };
    const lines: PersonDataLine[] = [];
    for (const ref of PERSON_REFERENCES) {
      const rows = await countRows(tx, ref, who);
      if (rows === 0) continue;
      lines.push({ ...ref, rows });
      totals[ref.action] += rows;
    }
    return { tenantId, userId, found: true, cognitoSub: row.external_id, lines, totals };
  });
}
