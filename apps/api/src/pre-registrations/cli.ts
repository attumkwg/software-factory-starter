import type { RootDb } from "../db/client.ts";
import { runDelete, runFind, runPurge, runReport } from "./command.ts";

// cli.ts の「数だけを出す運営のコマンド」の表(COUNT_COMMANDS)に混ぜる、事前登録の4つのコマンド
// (docs/runbooks/pre-registrations.md)。事前登録は運営の組織の持ち物なので、SUPPORT_TENANT_ID が無ければ止める。
//   pre-registrations-report [--from YYYY-MM-DD] [--to YYYY-MM-DD] … 来た所ごとの見た数・登録・確認と率(読むだけ)
//   pre-registrations-find               … アドレスから登録を1件探し、ID と状態だけを出す(アドレスは標準入力から1行。読むだけ。G-123)
//   pre-registrations-purge [--execute]  … 消す日を過ぎた事前登録・古い日ごとの数を消す(試し → 本番)
//   pre-registrations-delete [--execute] … 問い合わせのあったアドレスの事前登録を消す(アドレスは標準入力から1行。試し → 本番)

type CountCommand = (db: RootDb, args: string[]) => Promise<string[]>;

/** 運営の組織の ID(無ければ止める) */
export function operatorTenantIdFrom(env: Record<string, string | undefined>): string {
  const id = env.SUPPORT_TENANT_ID;
  if (!id) throw new Error("SUPPORT_TENANT_ID(運営の組織)がありません");
  return id;
}

/** 標準入力の最初の1行(メールアドレスをコマンドの引数に書かない = 端末の履歴に残さない) */
async function readLine(): Promise<string> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.includes("\n")) break;
  }
  return input.split("\n")[0]?.trim() ?? "";
}

/** コマンドの名前 → 中身。env は cli.ts の process.env */
export function preRegistrationCommands(
  env: Record<string, string | undefined>,
): Record<string, CountCommand> {
  return {
    "pre-registrations-report": (db, args) => runReport(db, operatorTenantIdFrom(env), args),
    "pre-registrations-find": async (db) => {
      const operatorTenantId = operatorTenantIdFrom(env);
      process.stderr.write("探す登録のメールアドレスを1行で入れてください: ");
      return runFind(db, operatorTenantId, await readLine());
    },
    "pre-registrations-purge": (db, args) => runPurge(db, operatorTenantIdFrom(env), args),
    "pre-registrations-delete": async (db, args) => {
      const operatorTenantId = operatorTenantIdFrom(env);
      process.stderr.write("消す登録のメールアドレスを1行で入れてください: ");
      return runDelete(db, operatorTenantId, await readLine(), args);
    },
  };
}
