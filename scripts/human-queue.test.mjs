import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ANSWER_MARK,
  answerComment,
  answeredAtOf,
  hasAnswer,
  MAX_QUESTIONS,
  prQuestionProblems,
  prQuestions,
  queueItems,
  renderQueue,
} from "./human-queue-lib.mjs";

const body = (rows) =>
  [
    "## 🧭 全体像",
    "",
    "## 🧑‍⚖️ 人に判断してほしい所",
    "",
    "<!-- 説明 | 表に見える | 行 | -->",
    "| # | 種類 | 設計した事実 | なぜそうしたか | 人が判断する問い |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## 🔎 観点ごとの扱い",
    "",
    "| 観点 | 扱い | 理由 |",
    "|---|---|---|",
    "| 人の手間 | 最重要 | 問いではない表 |",
  ].join("\n");

const row = (n, q) => `| ${n} | 事業判断 | 事実 ${n} | 理由 | ${q} |`;

test("PR の本文の「🧑‍⚖️」の表の問いだけを数える(見出し・区切り・空・なし・ほかの表は数えない)", () => {
  assert.deepEqual(prQuestions(body(["| | | | | |"])), []);
  assert.deepEqual(prQuestions(body(["| 1 | なし | | | |"])), []);
  assert.deepEqual(prQuestions("なし"), []);
  const qs = prQuestions(body([row(1, "(a) 12-06 か (b) 11-29 か")]));
  assert.equal(qs.length, 1);
  assert.equal(qs[0].question, "(a) 12-06 か (b) 11-29 か");
  assert.equal(qs[0].kind, "事業判断");
});

test("問いは多くて2つ。3つ目からは落ちる・長い問いは知らせる", () => {
  const two = prQuestionProblems(body([row(1, "A か B か"), row(2, "C か D か")]));
  assert.deepEqual(two.problems, []);
  assert.equal(two.count, MAX_QUESTIONS);
  const three = prQuestionProblems(body([row(1, "A か"), row(2, "B か"), row(3, "C か")]));
  assert.equal(three.problems.length, 1);
  assert.match(three.problems[0], /多くて 2 つ/);
  const long = prQuestionProblems(body([row(1, "あ".repeat(200))]));
  assert.deepEqual(long.problems, []);
  assert.equal(long.notes.length, 1);
  assert.equal(prQuestionProblems(body([row(1, "")])).problems.length, 1);
});

test("答えた日時はタイムゾーンつきの ISO 8601 だけ。先の時刻は断る", () => {
  const now = new Date("2026-10-29T10:00:00+09:00");
  assert.ok(answeredAtOf("2026-10-29T09:15:00+09:00", now).at);
  assert.ok(answeredAtOf("2026-10-29T00:15:00Z", now).at);
  for (const bad of ["", "2026-10-29", "2026-10-29 09:15", "2026-10-29T09:15:00"])
    assert.ok(answeredAtOf(bad, now).problem, bad);
  assert.match(answeredAtOf("2026-10-29T11:00:00+09:00", now).problem, /先の時刻/);
});

test("会話の答えの記録: 持ち主の言葉・日本時間の日時・当てた版・理由・問いを残し、積み場は答え済みと見る", () => {
  const sha = "bf9292a0123456789";
  const text = answerComment({
    reply: "160はいいと思います。\nマージして",
    answeredAt: new Date("2026-10-29T00:15:00Z"),
    owner: "attumkwg",
    where: "チャット",
    reasons: ["印 risk:high が付いている"],
    questions: ["課金: 価格表を変えてよいか"],
    sha,
  });
  assert.ok(text.startsWith(`${ANSWER_MARK}・2026-10-29 09:15 日本時間)`));
  assert.match(text, /@attumkwg\(チャット\)「160はいいと思います。 マージして」/);
  assert.match(text, /`bf9292a`/);
  assert.match(text, /印 risk:high/);
  assert.match(text, /課金: 価格表を変えてよいか/);
  assert.equal(hasAnswer([{ body: text }]), true);
  assert.equal(hasAnswer([{ body: text }], sha), true);
  assert.equal(hasAnswer([{ body: text }], "ffffffff"), false, "別の版に当てた答え");
  assert.equal(hasAnswer([{ body: "マージして" }]), false, "形の無いコメントは答えに数えない");
});

test("積み場: 印か問いのある PR・needs-human の Issue・人の判定待ちの意義の判断を、古い順に", () => {
  const now = new Date("2026-10-29T08:00:00+09:00");
  const pr = (number, extra) => ({
    number,
    title: `PR ${number}`,
    draft: false,
    labels: [],
    body: "",
    created_at: "2026-10-28T00:00:00Z",
    ...extra,
  });
  const items = queueItems({
    prs: [
      pr(1, { labels: ["risk:high"], created_at: "2026-10-20T00:00:00Z" }),
      pr(2, { body: body([row(1, "A か B か")]) }),
      pr(3, { labels: ["risk:low"] }),
      pr(4, { labels: ["risk:high"], draft: true }),
      pr(5, { labels: ["risk:high"], answered: true }),
    ],
    issues: [{ number: 9, title: "質問", created_at: "2026-10-25T00:00:00Z" }],
    verdicts: [{ path: "docs/kit/verdicts/x.md", title: "公開", by: "2026-10-27T00:00:00+09:00" }],
    now,
  });
  assert.deepEqual(
    items.map((i) => i.ref),
    ["#1", "#9", "docs/kit/verdicts/x.md", "#2"],
  );
  assert.equal(items[0].waitDays, 8);
  assert.equal(items.at(-1).ask, "A か B か");
  const text = renderQueue(items, "2026-10-29");
  assert.match(text, /4件\(PR 2件・Issue 1件・意義の判断 1件\)/);
  assert.match(text, /いちばん古いのは 8 日待ち/);
  assert.match(renderQueue([], "2026-10-29"), /判断待ちはありません/);
});

test("人が決めることの一覧: 強制か頼みかを全部の行に書き、強制なら止める物を書く", () => {
  const md = readFileSync("docs/concepts/human-decisions.md", "utf8");
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## 1."));
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("| ") || line.startsWith("|---") || line.includes("| 強制か頼みか |"))
      continue;
    rows.push(line.split("|").map((c) => c.trim()));
  }
  assert.ok(rows.length >= 8, `行が ${rows.length}`);
  for (const cells of rows) {
    const [, what, , mode, by] = cells;
    assert.match(mode, /^(強制|頼み)/, `${what}: 強制か頼みか`);
    assert.ok(by.length > 0, `${what}: 止める物・書いてある所`);
    assert.ok(cells.length - 2 <= 6, `${what}: 列は6つまで`);
  }
});
