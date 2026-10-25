// 外へ出した物の表(docs/designs/0057-ai-egress.md の 6)。中身は .claude/hooks/record-outbound.mjs が書いた記録。
//   pnpm outbound          .claude/outbound.log を PR の本文に貼る表(Markdown)にする。「頼まれていたか」は AI が書き足す
//   pnpm outbound --clear  記録を空にする(PR を出し終えたら。次の作業の分と混ぜない)
// 記録が無ければ「なし」と出す(空でも「なし」と書く決まり)。
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const LOG = ".claude/outbound.log";

if (process.argv.includes("--clear")) {
  writeFileSync(LOG, "");
  console.log(`${LOG} を空にしました`);
  process.exit(0);
}

const rows = existsSync(LOG)
  ? readFileSync(LOG, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      })
  : [];

if (rows.length === 0) {
  console.log("なし");
  process.exit(0);
}
console.log("| 時刻 | 手段 | 宛先 | 頼まれていたか | 何のため |");
console.log("|---|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.at.slice(11, 16)} | ${r.means} | ${r.target} | ? | ? |`);
}
console.log(
  "\n「?」を埋める: 頼まれていたかは依頼の文のどこに当たるか(当たらなければ **いいえ** にし、「人に判断してほしい所」にも1行)。",
);
