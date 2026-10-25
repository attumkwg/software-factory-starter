import type { RootDb } from "../db/client.ts";
import { runDelete, runPurge, runReport } from "./command.ts";

// cli.ts から呼ぶ、事前登録の運営のコマンドの振り分け(docs/runbooks/pre-registrations.md)。
// 接続を開く・閉じる・出す行を書くのは cli.ts。運営の組織(SUPPORT_TENANT_ID)が無ければ止める。

export const PRE_REGISTRATION_COMMANDS = [
  "pre-registrations-report",
  "pre-registrations-purge",
  "pre-registrations-delete",
] as const;
type PreRegistrationCommand = (typeof PRE_REGISTRATION_COMMANDS)[number];

export const isPreRegistrationCommand = (
  name: string | undefined,
): name is PreRegistrationCommand =>
  (PRE_REGISTRATION_COMMANDS as readonly string[]).includes(name ?? "");

/** 運営の組織の ID(無ければ止める。事前登録は運営の組織の持ち物) */
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

export async function runPreRegistrationCommand(
  name: PreRegistrationCommand,
  args: string[],
  db: RootDb,
  operatorTenantId: string,
): Promise<string[]> {
  if (name === "pre-registrations-report") return runReport(db, operatorTenantId, args);
  if (name === "pre-registrations-purge") return runPurge(db, operatorTenantId, args);
  process.stderr.write("消す登録のメールアドレスを1行で入れてください: ");
  return runDelete(db, operatorTenantId, await readLine(), args);
}
