// PostToolUse: ファイルを書いたら、すぐ整形して lint する(1秒未満)。
// lint の誤りが残ったら exit 2 で Claude に返し、その場で直させる。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = input.tool_input?.file_path;
if (!file) process.exit(0);

const shell = process.platform === "win32";

if (/\.(c|m)?(j|t)sx?$|\.jsonc?$|\.css$/.test(file)) {
  const r = spawnSync(
    "pnpm",
    [
      "exec",
      "biome",
      "check",
      "--write",
      "--no-errors-on-unmatched",
      "--files-ignore-unknown=true",
      file,
    ],
    { encoding: "utf8", shell },
  );
  if (r.status !== 0) {
    process.stderr.write(`Biome の指摘が残っています。直してください:\n${r.stdout}${r.stderr}`);
    process.exit(2);
  }
} else if (file.endsWith(".tf")) {
  // terraform が無い環境では飛ばす(CI の terraform.yml で必ず確かめる)
  spawnSync("terraform", ["fmt", file], { stdio: "ignore", shell });
}
