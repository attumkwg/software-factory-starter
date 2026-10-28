// pnpm decisions の中身(decisions-lib.mjs)のテスト。node --test scripts/decisions.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adoptLines,
  approverOf,
  byDesign,
  changedAnswers,
  conversationAnswerOf,
  conversationAnswerProblems,
  dueDateOf,
  evidenceOf,
  evidenceProblems,
  groupRows,
  readDecisions,
  soloFrom,
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

// ── 人の答えの出どころ(G-61・仕様 0061)──
const LINK = "https://github.com/acme/app/pull/12#issuecomment-345";
const text = (...rows) => design("docs/designs/0061-x.md", rows).text;
const human = (body, login = "suzuki", extra = {}) => ({
  user: { login, type: extra.type ?? "User" },
  author_association: extra.association ?? "OWNER",
  body,
});
const check = (state, item, extra = {}) =>
  evidenceProblems({
    row: { id: "U-1", state },
    evidence: evidenceOf(state),
    item,
    repo: "acme/app",
    prNumber: extra.prNumber ?? 12,
    designNumber: "0061",
  });

test("PR で人の答えに変わった行だけを拾う(仮決めのまま・同じ文・取り下げは拾わない)", () => {
  const base = text(row("U-1", "仮決め"), row("U-2", "仮決め"), row("U-3", "承認(@a 2026-10-01)"));
  const head = text(
    row("U-1", `承認(@suzuki 2026-11-03 ${LINK})`),
    row("U-2", "取り下げ(作り直しで問いが無くなった)"),
    row("U-3", "承認(@a 2026-10-01)"),
    row("U-4", "保留(@suzuki: 2026-12-01 までに)"),
    row("U-5", "仮決め"),
  );
  assert.deepEqual(
    changedAnswers(base, head).map((r) => r.id),
    ["U-1", "U-4"],
  );
  // 新しい設計書に、いきなり承認で書いた行も拾う
  assert.deepEqual(
    changedAnswers("", text(row("U-1", ADOPTED))).map((r) => r.id),
    ["U-1"],
  );
});

test("リンクを読む(コメント・レビュー・行のコメント)。ほかの形は読まない", () => {
  assert.deepEqual(evidenceOf(`承認(@s 2026-11-03 ${LINK})`), {
    url: LINK,
    repo: "acme/app",
    number: 12,
    type: "comment",
    id: "345",
  });
  assert.equal(
    evidenceOf("承認(https://github.com/acme/app/pull/3#pullrequestreview-9)").type,
    "review",
  );
  assert.equal(
    evidenceOf("https://github.com/acme/app/pull/3#discussion_r77。").type,
    "review_comment",
  );
  assert.equal(evidenceOf("承認(@s 2026-11-03。会話で回答)"), undefined);
  assert.equal(evidenceOf("https://github.com/acme/app/pull/3"), undefined);
  assert.equal(evidenceOf("https://example.com/acme/app/pull/3#issuecomment-1"), undefined);
  assert.equal(approverOf("承認(@suzuki-2 2026-11-03)"), "suzuki-2");
  assert.equal(approverOf("保留(: 2026-12-01 までに)"), undefined);
});

test("人(書き込める人)が、この PR で番号を書いて答えていれば通る", () => {
  assert.deepEqual(check(`承認(@suzuki 2026-11-03 ${LINK})`, human("U-1 承認します")), []);
  // 名前の大文字小文字は問わない
  assert.deepEqual(check(`承認(@Suzuki 2026-11-03 ${LINK})`, human("U-1 承認")), []);
});

test("リンクが無い・ボット・外の人・名前が違う・番号が無い、は落とす", () => {
  const has = (problems, word) => problems.some((p) => p.includes(word));
  assert.ok(has(check("承認(@suzuki 2026-11-03。会話で回答)", undefined), "リンクが無い"));
  assert.ok(
    has(
      check(`承認(@suzuki 2026-11-03 ${LINK})`, human("U-1 承認", "claude[bot]", { type: "Bot" })),
      "ボット",
    ),
  );
  assert.ok(
    has(
      check(
        `承認(@suzuki 2026-11-03 ${LINK})`,
        human("U-1 承認", "suzuki", { association: "NONE" }),
      ),
      "書き込める人ではない",
    ),
  );
  assert.ok(has(check(`承認(@suzuki 2026-11-03 ${LINK})`, human("U-1 承認", "tanaka")), "違う"));
  assert.ok(has(check(`承認(2026-11-03 ${LINK})`, human("U-1 承認")), "@名前"));
  assert.ok(has(check(`承認(@suzuki 2026-11-03 ${LINK})`, human("承認します")), "U-1 が無い"));
  assert.ok(has(check(`承認(@suzuki 2026-11-03 ${LINK})`, undefined), "読めない"));
  const other = "承認(@suzuki 2026-11-03 https://github.com/evil/app/pull/1#issuecomment-1)";
  assert.ok(has(check(other, human("U-1")), "別のリポジトリ"));
});

test("別の PR・Issue の答えを指すなら、設計書の番号も要る(同じ U-1 の使い回しを防ぐ)", () => {
  const state = `承認(@suzuki 2026-11-03 ${LINK})`;
  assert.ok(check(state, human("U-1 承認"), { prNumber: 99 }).some((p) => p.includes("0061")));
  assert.deepEqual(check(state, human("0061 の U-1 承認"), { prNumber: 99 }), []);
});

// ── 1人の間の会話の答え(仕様 0080)──
test("1人の間は、持ち主の Slack・チャット(Claude Code の会話)の返事を答えにできる", () => {
  for (const where of ["Slack の返事", "会話で回答", "チャットで回答"]) {
    const row = { id: "U-1", state: `承認(@attumkwg 2026-10-29 ${where})` };
    assert.equal(conversationAnswerOf(row.state), true, where);
    assert.deepEqual(conversationAnswerProblems({ row, solo: true, owner: "attumkwg" }), []);
  }
  assert.equal(conversationAnswerOf(`承認(@suzuki 2026-11-03 ${LINK})`), false);
});

test("会話の答えは、人が増えたら(承認数が 1 以上)・持ち主でない名前・名前が無いと答えにならない", () => {
  const row = { id: "U-1", state: "承認(@attumkwg 2026-10-29 Slack の返事)" };
  const problems = (r, solo = true) =>
    conversationAnswerProblems({ row: r, solo, owner: "attumkwg" })[0] ?? "";
  assert.ok(problems(row, false).includes("1人の間だけ"));
  assert.ok(
    problems({ id: "U-2", state: "承認(@suzuki 2026-10-29 会話で回答)" }).includes("持ち主"),
  );
  assert.ok(problems({ id: "U-3", state: "承認(2026-10-29 Slack の返事)" }).includes("@名前"));
});

test("1人の間かは setup.yml の required_approvals で決まる", () => {
  assert.equal(soloFrom("ruleset:\n  required_approvals: 0 # 1人\n"), true);
  assert.equal(soloFrom("ruleset:\n  required_approvals: 1\n"), false);
  assert.equal(soloFrom(""), false);
});
