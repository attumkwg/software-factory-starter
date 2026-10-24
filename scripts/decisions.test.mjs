// pnpm decisions の中身(decisions-lib.mjs)のテスト。node --test scripts/decisions.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adoptLines,
  byDesign,
  dueDateOf,
  groupRows,
  readDecisions,
  verdict,
} from "./decisions-lib.mjs";

const TODAY = "2026-10-24";
const ADOPTED = "導入時に決める(キットの既定は @attumkwg 2026-10-22 に承認)";

// 未確定事項の1行。state と kind だけ変えられる
const row = (id, state, kind = "事業判断") =>
  `| ${id} | 設計 | ${kind} | 既定の${id} | なぜ | 問いの${id} | ${state} |`;

const design = (path, rows) => ({
  path,
  text: [
    "## 12. 未確定事項",
    "| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n"),
});

const read = (...rows) => readDecisions([design("docs/designs/0001-a.md", rows)], TODAY);

test("導入時に決める を読む(状態の頭・どこにあるか)", () => {
  const { rows, problems } = read(row("U-1", ADOPTED));
  assert.deepEqual(problems, []);
  assert.equal(rows[0].head, "導入時に決める");
  assert.equal(rows[0].where, "docs/designs/0001-a.md:4");
  assert.equal(groupRows(rows).adopt.length, 1);
});

test("@ の無い 導入時に決める は書き方の問題(人の答えを経ずにすり抜けない)", () => {
  const { problems } = read(row("U-1", "導入時に決める"));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /U-1 の導入時に決めるに、キットの既定を承認した人/);
});

test("種類が4つでないと、導入時に決める でも書き方の問題", () => {
  const { problems } = read(row("U-1", ADOPTED, "技術の選び方"));
  assert.match(problems[0], /種類「技術の選び方」は4つのどれでもない/);
});

test("知らない状態・列の数の違いは書き方の問題", () => {
  const { problems } = read(row("U-1", "たぶん"), "| U-2 | 設計 | 事業判断 | 足りない |");
  assert.equal(problems.length, 2);
  assert.match(problems[0], /状態「たぶん」は .* 導入時に決める で始めて/);
  assert.match(problems[1], /列の数が7ではない\(4\)/);
});

test("見出しの行・番号でない行は読まない", () => {
  const { rows, problems } = read("| U-x | 設計 | 事業判断 | a | b | c | 仮決め |");
  assert.deepEqual(rows, []);
  assert.deepEqual(problems, []);
});

test("保留の期限: 無い・過ぎたら書き方の問題。期限内はよい", () => {
  assert.equal(dueDateOf("保留(@a: 2026-11-30 までに決める)"), "2026-11-30");
  assert.equal(dueDateOf("保留(@a: 来月までに)"), undefined);
  const { problems } = read(
    row("U-1", "保留(@a: 2026-11-30 までに決める)"),
    row("U-2", "保留(@a: そのうち)"),
    row("U-3", "保留(@a: 2026-10-01 までに決める)"),
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /U-2 の保留に期限/);
  assert.match(problems[1], /U-3 の保留の期限\(2026-10-01\)が過ぎた/);
});

test("--strict: 導入時に決める だけなら 0(キットの既定でマージしてよい)", () => {
  assert.equal(verdict(read(row("U-1", ADOPTED)), { strict: true }).fail, false);
});

test("--strict: 仮決め・書き方の問題で 1", () => {
  assert.equal(verdict(read(row("U-1", "仮決め")), { strict: true }).fail, true);
  assert.equal(verdict(read(row("U-1", "たぶん")), { strict: true }).fail, true);
});

test("旗なしは何があっても 0(一覧を出すだけ)", () => {
  assert.equal(verdict(read(row("U-1", "仮決め"), row("U-2", ADOPTED))).fail, false);
});

test("--launch: 導入時に決める が残れば 1", () => {
  const v = verdict(read(row("U-1", ADOPTED)), { launch: true });
  assert.equal(v.fail, true);
  assert.match(v.message, /導入時に決める 1件/);
});

test("--launch: 仮決めで 1・期限の過ぎた保留で 1", () => {
  assert.equal(verdict(read(row("U-1", "仮決め")), { launch: true }).fail, true);
  const expired = read(row("U-1", "保留(@a: 2026-10-01 までに決める)"));
  assert.equal(verdict(expired, { launch: true }).fail, true);
});

test("--launch: 承認・変更・取り下げ・期限内の保留だけなら 0", () => {
  const v = verdict(
    read(
      row("U-1", "承認(@user 2026-10-24)"),
      row("U-2", "変更(@user 2026-10-24: 7日にする)"),
      row("U-3", "取り下げ(作り直しで無くなった)"),
      row("U-4", "保留(@user: 2026-11-30 までに決める)"),
    ),
    { launch: true },
  );
  assert.equal(v.fail, false);
  assert.match(v.message, /残っていません/);
});

test("--strict と --launch を重ねたら厳しいほう(launch)で判定する", () => {
  assert.equal(verdict(read(row("U-1", ADOPTED)), { strict: true, launch: true }).fail, true);
});

test("--adopt: 設計書ごとにまとめ、既定・問い・決め方を出す", () => {
  const result = readDecisions(
    [
      design("docs/designs/0001-a.md", [row("U-1", ADOPTED), row("U-2", "承認(@k 2026-10-22)")]),
      design("docs/designs/0002-b.md", [row("U-1", ADOPTED), row("U-3", ADOPTED)]),
    ],
    TODAY,
  );
  const text = adoptLines(result.rows).join("\n");
  assert.match(text, /導入時に決める.*: 3件/);
  assert.ok(text.includes("■ docs/designs/0001-a.md(1件)"));
  assert.ok(text.includes("■ docs/designs/0002-b.md(2件)"));
  assert.ok(text.includes("- U-1(事業判断)キットの既定: 既定のU-1"));
  assert.ok(text.includes("問い: 問いのU-3  … docs/designs/0002-b.md:5"));
  assert.match(text, /既定のままでよい → 承認/);
  assert.match(text, /変える → 変更.*\/rework/);
  assert.match(text, /pnpm decisions --launch/);
});

test("承認・変更にした行は --adopt に出ない", () => {
  const result = read(
    row("U-1", "承認(@user 2026-10-24)"),
    row("U-2", "変更(@user 2026-10-24: x)"),
  );
  const text = adoptLines(result.rows).join("\n");
  assert.match(text, /: 0件/);
  assert.doesNotMatch(text, /■/);
});

test("設計書のパスでまとめる(行番号の「:」で切る)", () => {
  const { rows } = read(row("U-1", ADOPTED), row("U-2", ADOPTED));
  assert.deepEqual([...byDesign(rows).keys()], ["docs/designs/0001-a.md"]);
});
