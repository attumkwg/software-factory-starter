// 未確定事項の一覧: 設計書(docs/designs/*.md)の「未確定事項」の表から、
// まだ人が答えていない行(仮決め)と、後で決める行(保留)を集めて出す。
//   pnpm decisions            一覧を出す
//   pnpm decisions --strict   仮決めが残っている・書き方が違う・保留の期限が過ぎた ときは 1 で終わる(マージの前に)
// 書き方は docs/guides/human-review.md の 2。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/designs";
const KINDS = ["事業判断", "利用者の挙動", "他チームとの契約や制約", "戻せないリスク"];
const STATES = ["仮決め", "承認", "変更", "保留", "取り下げ"];
const strict = process.argv.includes("--strict");
const today = new Date().toISOString().slice(0, 10);

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");

// 「U-1」「U-12」のような番号か
const isDecisionId = (cell) => cell.startsWith("U-") && isDigits(cell.slice(2));

// 「保留(@名前: 2026-11-30 までに)」から「2026-11-30」を取り出す。無ければ undefined
const dueDateOf = (state) => {
  const at = state.indexOf("までに");
  if (at < 0) return undefined;
  const date = state.slice(0, at).trimEnd().slice(-10);
  const [y, m, d] = date.split("-");
  const ok = y?.length === 4 && m?.length === 2 && d?.length === 2;
  return ok && isDigits(y) && isDigits(m) && isDigits(d) ? date : undefined;
};

const open = [];
const deferred = [];
const problems = [];

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort();

for (const file of files) {
  const path = join(DIR, file);
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((raw, i) => {
    // 正規表現を使わずに読む(Semgrep の regex_dos に当たらないように)
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) return;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (!isDecisionId(cells[0])) return;
    const where = `${path}:${i + 1}`;
    if (cells.length !== 7) {
      problems.push(`${where} 列の数が7ではない(${cells.length})`);
      return;
    }
    const [id, stage, kind, fact, , question, state] = cells;
    if (!KINDS.includes(kind)) {
      problems.push(
        `${where} ${id} の種類「${kind}」は4つのどれでもない(4つに当たらないなら「決めたこと」へ)`,
      );
    }
    const head = STATES.find((s) => state.startsWith(s));
    if (!head) {
      problems.push(`${where} ${id} の状態「${state}」は ${STATES.join(" / ")} で始めてください`);
      return;
    }
    const row = { where, id, stage, kind, fact, question, state };
    if (head === "仮決め") open.push(row);
    if (head === "保留") {
      deferred.push(row);
      const due = dueDateOf(state);
      if (!due) problems.push(`${where} ${id} の保留に期限(YYYY-MM-DD までに)が無い`);
      else if (due < today) problems.push(`${where} ${id} の保留の期限(${due})が過ぎた`);
    }
  });
}

const show = (title, rows) => {
  console.log(`\n${title}: ${rows.length}件`);
  for (const r of rows) {
    console.log(`- ${r.id}(${r.stage}・${r.kind})${r.fact}`);
    console.log(`    問い: ${r.question}`);
    console.log(`    状態: ${r.state}  … ${r.where}`);
  }
};

console.log(`設計書 ${files.length}件を読みました(${DIR})`);
show("🟡 仮決め(人がまだ答えていない)", open);
show("⏸ 保留(後で決める)", deferred);
if (problems.length > 0) {
  console.log(`\n⚠️ 書き方の問題: ${problems.length}件`);
  for (const p of problems) console.log(`- ${p}`);
}

if (strict && (open.length > 0 || problems.length > 0)) {
  console.log(
    "\n❌ 仮決めか書き方の問題が残っています。人の答えをもらってから、マージしてください。",
  );
  process.exit(1);
}
