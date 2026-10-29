import { type SQL, sql } from "drizzle-orm";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  findPerson,
  PERSON_REFERENCES,
  type PersonDataPlan,
  personMatch,
  planPersonDataIn,
  table,
} from "./plan-person-data.ts";

// 利用者1人分を消す・匿名化する(docs/specs/0089-person-erase.md・ADR 0088)。手順は docs/runbooks/person-data.md の 5。
// 試し(plan-person-data.ts)と**同じ一覧(PERSON_REFERENCES)・同じ条件(personMatch)**で、扱いのとおりに:
//   anonymize … 下の ANONYMIZE の列を置き換える(行は残す。ほかの行が指しているため)
//   delete    … 行ごと消す
//   keep      … 触らない(人の ID だけが残る。監査ログ・同意・作った人)
// 1つのトランザクションで流し、終わる前に数え直して delete の行が残っていれば全部取り消す。
// その組織の監査ログに「仕組みが・その人の ID を・何件」を残す(名前・メールは残さない)。

/** 匿名化した人の名前(画面の一覧・監査ログの「誰が」に出る) */
export const ERASED_NAME = "削除した利用者";

/**
 * 匿名化で置き換える列(表ごと)。**扱いが anonymize の表の、列の分類で personal の列は全部ここに**
 * (無ければ結合テスト person-erase.int.test.ts が落ちる)。メールは行の ID から作る(一意の索引に当たらない・届かない)
 */
export const ANONYMIZE: Readonly<Record<string, Readonly<Record<string, SQL>>>> = {
  "organizations.users": {
    name: sql`${ERASED_NAME}`,
    email: sql`'deleted-' || id || '@invalid'`,
    // Cognito・情シスの道具との結びつきを切る(Cognito の利用者は手順書の 5 で先に消す)
    external_id: sql`null`,
    scim_external_id: sql`null`,
    // 止めて、残っているセッションも切る(契約の人数にも数えない)
    disabled_at: sql`coalesce(disabled_at, now())`,
    sessions_valid_after: sql`now()`,
  },
  "organizations.invitations": { email: sql`'deleted-' || id || '@invalid'` },
};

/**
 * 一覧の表にあるのに、消さない・置き換えない personal の列と、その理由。**本人の値ではない物だけ**
 * (お客さんの業務の自由な文・運営の社員の値)。ここにも ANONYMIZE にも無く、行も消さない列があれば結合テストが落ちる
 */
export const KEPT_PERSONAL_COLUMNS: Readonly<Record<string, string>> = {
  "files.files.name": "写真・ファイルの名前(組織の業務の記録。お客さんの物)",
  "projects.projects.name": "プロジェクトの名前(組織の業務の記録。お客さんの物)",
  "organizations.support_sessions.staff_name": "入った運営の社員の名前(本人ではない)",
  "organizations.support_sessions.staff_email": "入った運営の社員のメール(本人ではない)",
};

export type PersonErasure = PersonDataPlan & { mode: "erased" };

/**
 * 1人分を消す。confirmRows は試しの anonymize と delete の合計(試しの後で行が変わっていたら、何も変えずに止める)。
 * その組織にいなければ止める(ほかの組織にいるかは言わない)。
 */
export async function erasePersonData(
  db: RootDb,
  tenantId: string,
  userId: string,
  opts: { confirmRows: number; supportTenantId: string | null },
): Promise<PersonErasure> {
  if (opts.supportTenantId && tenantId === opts.supportTenantId) {
    throw new Error(
      "運営の組織の人(社員)は、この手順では消しません(社員の名前は入室の記録にも写る)",
    );
  }
  return withTenant(db, tenantId, async (tx) => {
    const plan = await planPersonDataIn(tx, tenantId, userId);
    const who = await findPerson(tx, tenantId, userId);
    if (!plan.found || !who) throw new Error("その組織にその利用者はいません。何も変えていません");
    const changing = plan.totals.anonymize + plan.totals.delete;
    if (changing !== opts.confirmRows) {
      throw new Error(
        `--confirm-rows が試しの数(${changing})と違うので、何も変えていません(試しを流し直してください)`,
      );
    }
    // 消すのが先(メールで指す行は、匿名化の前のメールで探す。who.emails は消す前に読んだ物)
    for (const ref of PERSON_REFERENCES.filter((r) => r.action === "delete")) {
      await tx.execute(sql`delete from ${table(ref.table)} where ${personMatch(ref, who)}`);
    }
    for (const ref of PERSON_REFERENCES.filter((r) => r.action === "anonymize")) {
      const columns = ANONYMIZE[ref.table];
      if (!columns) throw new Error(`匿名化の列がありません: ${ref.table}`);
      const set = sql.join(
        Object.entries(columns).map(([c, v]) => sql`${sql.identifier(c)} = ${v}`),
        sql`, `,
      );
      await tx.execute(sql`update ${table(ref.table)} set ${set} where ${personMatch(ref, who)}`);
    }
    await recordAudit(tx, {
      tenantId,
      actor: { kind: "system", id: null },
      action: MANUAL_AUDIT_ACTIONS.personErase,
      target: { type: "member", id: userId },
      outcome: "allowed",
      details: { anonymize: plan.totals.anonymize, delete: plan.totals.delete },
    });
    // 数え直す。消すはずの行と、前のメールで指す行が残っていれば、投げてトランザクションごと取り消す
    const after = await planPersonDataIn(tx, tenantId, userId);
    const left = after.lines.filter((l) => l.action === "delete" || l.by === "email");
    if (left.length > 0) {
      throw new Error(
        `消し残しがあるので、何も変えていません: ${left.map((l) => `${l.table}.${l.column}`).join(", ")}`,
      );
    }
    return { ...plan, mode: "erased" };
  });
}
