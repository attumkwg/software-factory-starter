import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  bodySaysHigh,
  checkState,
  FIX_MARK,
  humanOnlyReasons,
  mergeQueueOn,
  prProblems,
  REVIEW_MARK,
  requiredChecksFrom,
  reviewDecisions,
  reviewedShaOf,
  reviewState,
  SENSOR_MARK,
  sensorComment,
  sensorMergeBlockers,
  sensorsOnlyFrom,
} from "./pr-merge-lib.mjs";

test("setup.yml の必須のチェックを、注を外して読む", () => {
  const checks = requiredChecksFrom(readFileSync(".github/setup.yml", "utf8"));
  assert.ok(checks.includes("Biome・型・単体"));
  assert.ok(checks.includes("取り組みと作業の種類(PR の本文)"));
  assert.ok(checks.every((c) => !c.includes("#")));
});

const run = (name, conclusion, status = "completed") => ({ name, status, conclusion });

test("必須のチェックが全部緑のときだけ green。足りない・途中は待つ・落ちたら failed", () => {
  const required = ["A", "B"];
  assert.equal(checkState(required, [run("A", "success"), run("B", "skipped")]).green, true);
  assert.deepEqual(checkState(required, [run("A", "success")]).pending, ["B"]);
  assert.deepEqual(
    checkState(required, [run("A", "success"), run("B", null, "in_progress")]).pending,
    ["B"],
  );
  assert.deepEqual(checkState(required, [run("A", "failure"), run("B", "success")]).failed, [
    "A(failure)",
  ]);
});

test("同じ名前が何度も流れたら、新しい方(先頭)を見る", () => {
  const state = checkState(["A"], [run("A", "success"), run("A", "failure")]);
  assert.equal(state.green, true);
});

test("開いていない・下書き・main 向けでない PR はマージしない", () => {
  const ok = { state: "open", draft: false, base: { ref: "main" } };
  assert.deepEqual(prProblems(ok), []);
  assert.equal(prProblems({ ...ok, state: "closed" }).length, 1);
  assert.equal(prProblems({ ...ok, draft: true }).length, 1);
  assert.equal(prProblems({ ...ok, base: { ref: "release" } }).length, 1);
});

test("危険度「高」・テストを弱めた印・守りの場所に触る PR は、人の答えが要る(1人の間は会話の答えを記録してマージ)", () => {
  const protectedPaths = JSON.parse(
    readFileSync(".claude/hooks/protected-paths.json", "utf8"),
  ).paths;
  const ok = { labels: ["risk:low"], files: ["apps/web/src/pages/TasksPage.tsx"], protectedPaths };
  assert.deepEqual(humanOnlyReasons(ok), []);
  for (const labels of [["risk:high"], ["tests:weakened"]]) {
    assert.equal(humanOnlyReasons({ ...ok, labels }).length, 1, labels[0]);
  }
  for (const file of [
    ".github/workflows/ci.yml",
    ".claude/skills/slack-request/SKILL.md",
    "CLAUDE.md",
    "scripts/pr-merge-lib.mjs",
    "apps/api/src/authz/policy.ts",
    "apps/api/drizzle/0024_member_roles.sql",
  ]) {
    assert.equal(humanOnlyReasons({ ...ok, files: [file] }).length, 1, file);
  }
});

test("センサーだけで入れるかのスイッチ(ai_merge.sensors_only)は、書いていなければ false(ADR 0094)", () => {
  assert.equal(sensorsOnlyFrom(readFileSync(".github/setup.yml", "utf8")), false);
  assert.equal(sensorsOnlyFrom("ai_merge:\n  sensors_only: true\n"), true);
  assert.equal(sensorsOnlyFrom("ai_merge: # 注\n\n  sensors_only: true # 注\n"), true);
  assert.equal(sensorsOnlyFrom("ai_merge:\n  sensors_only: false\n"), false);
  // ほかの節の同じ名前は読まない
  assert.equal(sensorsOnlyFrom("ai_merge:\nother:\n  sensors_only: true\n"), false);
  assert.equal(sensorsOnlyFrom("other:\n  sensors_only: true\n"), false);
  assert.equal(sensorsOnlyFrom(undefined), false);
});

test("人を呼ぶ理由が1つでもあれば、センサーだけでは入れない(ADR 0094)", () => {
  const protectedPaths = JSON.parse(
    readFileSync(".claude/hooks/protected-paths.json", "utf8"),
  ).paths;
  const low = {
    labels: ["risk:low"],
    files: ["apps/web/src/pages/TasksPage.tsx"],
    protectedPaths,
    body: "## ⚠️ 危険度\n\n- [x] 低: 文言\n- [ ] 高: 認証",
    questionCount: 0,
    touchedAreaNames: [],
  };
  assert.deepEqual(sensorMergeBlockers(low), []);
  const one = (over) => sensorMergeBlockers({ ...low, ...over });
  assert.match(one({ labels: ["needs-human"] }).join(), /needs-human/);
  assert.match(one({ labels: ["risk:high"] }).join(), /risk:high/);
  assert.match(one({ labels: ["tests:weakened"] }).join(), /tests:weakened/);
  assert.match(one({ questionCount: 1 }).join(), /問いが 1 つ/);
  assert.match(one({ body: "- [X] 高: CI の設定" }).join(), /本文の危険度が「高」/);
  assert.match(one({ touchedAreaNames: ["課金"] }).join(), /課金/);
  assert.match(one({ files: [".github/setup.yml"] }).join(), /守りの場所/);
  assert.equal(bodySaysHigh("- [ ] 高: 認証"), false);
});

test("センサーだけで入れた記録と、マージキューの見分け", () => {
  const c = sensorComment({ sha: "abcdef0123456789", required: 16, queued: true });
  assert.ok(c.startsWith(SENSOR_MARK));
  assert.match(c, /`abcdef0`/);
  assert.match(c, /16 件が全部緑/);
  assert.match(c, /マージキューに並べた/);
  assert.equal(mergeQueueOn([{ type: "pull_request" }, { type: "merge_queue" }]), true);
  assert.equal(mergeQueueOn([{ type: "required_status_checks" }]), false);
  assert.equal(mergeQueueOn(undefined), false);
});

// ── 書いた人と別の AI のレビューの記録(G-137・G-139・仕様 0096)──
const A = "aaaaaaa1111111111111111111111111111111aa";
const B = "bbbbbbb2222222222222222222222222222222bb";
const M = "ccccccc3333333333333333333333333333333cc";
const commit = (sha, merge = false) => ({ sha, parents: merge ? [{}, {}] : [{}] });
const table = (rows) =>
  [
    "| # | 人格 | 観点 | 所見(場所) | 重さ | 決めたこと | 理由 |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(([id, w, d]) => `| ${id} | 🦹 | 権限 | x | ${w} | ${d} | |`),
  ].join("\n");
const record = (sha, rows = [], who = "OWNER", at = "2026-10-29T10:00:00Z") => ({
  body: [
    `${REVIEW_MARK}・人格ごと・仕様 0096)`,
    "",
    `- 当てた版: \`${sha.slice(0, 7)}\``,
    "- 回した人格: 🦹 越えようとする人",
    "",
    table(rows),
  ].join("\n"),
  author_association: who,
  created_at: at,
  html_url: "https://example.test/c/1",
});
const fix = (sha, at = "2026-10-29T11:00:00Z", who = "OWNER") => ({
  body: [`${FIX_MARK}・仕様 0096)`, "", `- 直した版: \`${sha.slice(0, 7)}\`(#1)`].join("\n"),
  author_association: who,
  created_at: at,
});

test("レビューの記録: 無い・外の人の記録・回せなかった・版の形が違う は入れない(G-137・持ち主の決めた A)", () => {
  assert.match(reviewState([], A, [commit(A)]).problem, /レビューの記録が無い/);
  assert.match(
    reviewState([record(A, [], "NONE")], A, [commit(A)]).problem,
    /レビューの記録が無い/,
  );
  assert.match(
    reviewState([record(A, [], "CONTRIBUTOR")], A, [commit(A)]).problem,
    /レビューの記録が無い/,
  );
  const cannot = {
    ...record(A),
    body: record(A).body.replace("🦹 越えようとする人", "別の AI のレビューを回せなかった"),
  };
  assert.match(reviewState([cannot], A, [commit(A)]).problem, /回せなかった/);
  // 所見の文に「回せなかった」が出ても、回した人格の行が埋まっていれば止めない(#189 で見つけた取り違え)
  const mention = {
    ...record(A),
    body: `${record(A).body}\n| W1 | 🔍 | x | 「回せなかった」の記録で通る | ⚠️ | このまま(AI) | |`,
  };
  assert.equal(reviewState([mention], A, [commit(A)]).problem, undefined);
  const noPersonas = {
    ...record(A),
    body: record(A).body.replace("- 回した人格: 🦹 越えようとする人", ""),
  };
  assert.match(reviewState([noPersonas], A, [commit(A)]).problem, /回した人格/);
  const short = {
    ...record(A),
    body: [`${REVIEW_MARK})`, "- 当てた版: `abc`", "- 回した人格: 🦹"].join("\n"),
  };
  assert.match(reviewState([short], A, [commit(A)]).problem, /版の形でない/);
  assert.match(reviewState([record(B)], A, [commit(A)]).problem, /この PR の版に無い/);
  // 頭の前の空白は許す(BOM・空行で止めない)
  assert.equal(
    reviewState(
      [
        {
          ...record(A),
          body: `
 ${record(A).body}`,
        },
      ],
      A,
      [commit(A)],
    ).problem,
    undefined,
  );
});

test("レビューの記録: 所見なし・決めたことどおりなら入れる。main の取り込みだけの版は通す", () => {
  const ok = reviewState([record(A)], A, [commit(A)]);
  assert.equal(ok.problem, undefined);
  assert.equal(ok.reviewedSha, A.slice(0, 7));
  assert.equal(reviewState([record(A)], M, [commit(A), commit(M, true)]).problem, undefined);
  // いちばん新しい記録を見る
  assert.equal(
    reviewState([record(B, [], "OWNER", "2026-10-29T09:00:00Z"), record(A)], A, [
      commit(B),
      commit(A),
    ]).problem,
    undefined,
  );
});

test("レビューの記録: ❌・❓ に「未」が残れば入れない・⚠️ の未は通す(持ち主の決めた Q3)", () => {
  const c = [commit(A)];
  assert.match(
    reviewState([record(A, [["1", "❌", "今回は見ない"]])], A, c).problem,
    /決めていない/,
  );
  assert.match(reviewState([record(A, [["2", "❓", "未"]])], A, c).problem, /決めていない/);
  assert.equal(reviewState([record(A, [["3", "⚠️", "今回は見ない"]])], A, c).problem, undefined);
  assert.equal(
    reviewState([record(A, [["4", "❓", "このまま(@attumkwg)"]])], A, c).problem,
    undefined,
  );
});

test("レビューの記録: 「直す」は直した版が書かれるまで入れない・その後のレビューしていない版も止める(持ち主の決めた D)", () => {
  const rows = [["1", "❌", "直す(AI)"]];
  assert.match(reviewState([record(A, rows)], B, [commit(A), commit(B)]).problem, /直したこと/);
  // 直した版を書けば入る。その後の main の取り込みも通す
  const done = [record(A, rows), fix(B)];
  assert.equal(reviewState(done, B, [commit(A), commit(B)]).problem, undefined);
  assert.equal(reviewState(done, M, [commit(A), commit(B), commit(M, true)]).problem, undefined);
  assert.deepEqual(reviewState(done, B, [commit(A), commit(B)]).fixes, [B.slice(0, 7)]);
  // 直した版より後に、レビューしていない版を足したら止める
  assert.match(
    reviewState(done, M, [commit(A), commit(B), commit(M)]).problem,
    /レビューを経ていない版/,
  );
  // 記録より前の「直したこと」・外の人の「直したこと」は数えない
  assert.match(
    reviewState([record(A, rows), fix(B, "2026-10-29T09:00:00Z")], B, [commit(A), commit(B)])
      .problem,
    /直したこと/,
  );
  assert.match(
    reviewState([record(A, rows), fix(B, "2026-10-29T11:00:00Z", "NONE")], B, [
      commit(A),
      commit(B),
    ]).problem,
    /直したこと/,
  );
});

test("レビューの記録の読み方(版・決めたことの表)", () => {
  assert.equal(reviewedShaOf("当てた版: `abc1234`"), "abc1234");
  assert.equal(reviewedShaOf("当てた版: `abc"), "");
  assert.deepEqual(reviewDecisions(table([["1", "❌", "直す"]])), [
    { id: "1", weight: "❌", decided: "直す" },
  ]);
  assert.deepEqual(reviewDecisions("所見なし"), []);
});

test("レビューの記録: ❌ を直さずに残す・決めた人の印が無い・❓ を AI が決める は入れない(#191 のレビュー)", () => {
  const c = [commit(A)];
  const one = (row) => reviewState([record(A, [row]), fix(A)], A, c).problem;
  // ❌ は AI が直す。残すなら ❓ にして人の答えを入れる
  assert.match(one(["1", "❌", "このまま(AI)"]), /直さずに残している/);
  assert.match(one(["1", "❌", "新しい穴に回す(AI)"]), /直さずに残している/);
  assert.equal(one(["1", "❌", "直す(AI)"]), undefined);
  // ⚠️ はおすすめどおり AI が決めてよい(直す・このまま・新しい穴に回す)
  assert.equal(one(["2", "⚠️", "新しい穴に回す(AI)"]), undefined);
  // 決めた人の印が無ければ止める
  assert.match(one(["2", "⚠️", "直す"]), /決めた人の印/);
  // ❓ は人が決める
  assert.match(one(["3", "❓", "承知で進める(AI)"]), /人が決めていない/);
  assert.equal(one(["3", "❓", "承知で進める(@attumkwg)"]), undefined);
});
