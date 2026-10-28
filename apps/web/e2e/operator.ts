import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 運営のコマンド(apps/api/src/cli.ts)を、docker compose の移行のコンテナで流す(本番の ECS の1回きりのタスクの代わり)。
// 一周の E2E(journey.spec.ts)が使う。docker compose で立てたときだけ使える(プレビュー環境では使えない)。

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** 種データの「運営(サポート)」の組織(docker-compose.yml の SUPPORT_TENANT_ID。本番の手順書も環境変数で渡す) */
export const SUPPORT_TENANT_ID = "0199a000-0000-7000-8000-00000000c001";

/** docker compose が使えるか(プレビュー環境・compose の外では false) */
export function operatorAvailable(): boolean {
  if (process.env.E2E_BASE_URL) return false;
  try {
    execFileSync("docker", ["compose", "ps", "--quiet", "db"], { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

type Options = {
  /** 手元のフォルダを /journey に読み取りだけで見せる(申し込みの JSON を渡す) */
  mount?: string;
  env?: Record<string, string>;
  /** 標準入力に渡す1行(メールアドレスのように、引数に書かない値) */
  input?: string;
};

/** 運営のコマンドを1回流し、出た JSON の行を返す(コマンドは結果を JSON 1行で出す) */
export function operator(args: string[], options: Options = {}): Record<string, unknown> {
  const env = { SUPPORT_TENANT_ID, ...options.env };
  const out = execFileSync(
    "docker",
    [
      "compose",
      "run",
      "--rm",
      "--no-deps",
      "-T",
      ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      ...(options.mount ? ["-v", `${options.mount}:/journey:ro`] : []),
      "migrate",
      "dist/cli.js",
      ...args,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      ...(options.input === undefined
        ? { stdio: ["ignore", "pipe", "pipe"] }
        : { input: `${options.input}\n`, stdio: ["pipe", "pipe", "pipe"] }),
    },
  );
  const line = out.split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error(`運営のコマンドが JSON を出しませんでした: ${args[0]}\n${out}`);
  return JSON.parse(line) as Record<string, unknown>;
}
