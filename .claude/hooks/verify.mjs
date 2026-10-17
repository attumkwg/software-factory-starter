// Stop: 作業を終える前に、型チェックと「影響範囲のテスト」を必ず回す(AI が忘れても走る)。
// 影響範囲 = main からの変更で触ったパッケージと、それに依存するパッケージ(turbo --affected)。
// 失敗したら exit 2 で Claude に返して直させる。2回目も失敗したら止めて、人に渡す。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const shell = process.platform === "win32";

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", shell });

// 何も変えていなければ何もしない
const status = run("git", ["status", "--porcelain"]);
const ahead = run("git", ["rev-list", "--count", "origin/main..HEAD"]);
if (!status.stdout.trim() && ahead.stdout.trim() === "0") process.exit(0);

const r = run("pnpm", [
  "turbo",
  "run",
  "typecheck",
  "test",
  "--affected",
  "--output-logs=errors-only",
]);
if (r.status === 0) process.exit(0);

const tail = `${r.stdout}${r.stderr}`.split("\n").slice(-80).join("\n");
if (input.stop_hook_active) {
  process.stderr.write(
    `型チェックかテストが2回続けて落ちています。これ以上は自分で直さず、PR の「人に判断してほしい所」に状況を書いて止めてください。\n${tail}`,
  );
  process.exit(0);
}
process.stderr.write(`終わる前の確認で落ちました。直してから終えてください:\n${tail}`);
process.exit(2);
