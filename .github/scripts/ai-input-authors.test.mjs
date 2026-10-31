import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTrusted,
  judge,
  judgePii,
  MAX_TARGETS,
  numbersInPrompt,
  targetsOf,
  textsToRead,
  untrustedIn,
} from "./ai-input-authors-lib.mjs";
import { hitLines, scanTexts } from "./text-pii-lib.mjs";

const by = (login, association, kind = "コメント", extra = {}) => ({
  kind,
  user: { login, type: extra.type ?? "User" },
  author_association: association,
  body: extra.body ?? "本文",
});

test("頼む文から番号を拾う(#12・Issue の URL・PR の URL)", () => {
  assert.deepEqual(numbersInPrompt("Issue #12 と #3 を直して"), [3, 12]);
  assert.deepEqual(
    numbersInPrompt("https://github.com/a/b/issues/7 と https://github.com/a/b/pull/8"),
    [7, 8],
  );
  assert.deepEqual(numbersInPrompt("#12 #12 をもう一度"), [12]);
  assert.deepEqual(numbersInPrompt("ログイン画面の文言を直して"), []);
  assert.deepEqual(numbersInPrompt(undefined), []);
});

test("確かめる番号: 手動は頼む文から、@claude はコメントの付いた番号も", () => {
  assert.deepEqual(
    targetsOf({ eventName: "workflow_dispatch", prompt: "#5 を", issueNumber: "" }),
    [5],
  );
  assert.deepEqual(targetsOf({ eventName: "issue_comment", prompt: "", issueNumber: "9" }), [9]);
  assert.deepEqual(targetsOf({ eventName: "issues", prompt: "", issueNumber: "4" }), [4]);
  // 手動の起動では、画面から入った番号以外を足さない
  assert.deepEqual(targetsOf({ eventName: "workflow_dispatch", prompt: "", issueNumber: "9" }), []);
});

test("書き込める人と、決めたボットだけを信じる", () => {
  for (const a of ["OWNER", "MEMBER", "COLLABORATOR"]) assert.equal(isTrusted(by("x", a)), true);
  for (const a of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"])
    assert.equal(isTrusted(by("x", a)), false);
  assert.equal(isTrusted(by("github-actions[bot]", "NONE", "コメント", { type: "Bot" })), true);
  assert.equal(isTrusted(by("claude[bot]", "NONE", "コメント", { type: "Bot" })), true);
  // Renovate・Dependabot は上流のリリースノートを本文に写すので信じない
  assert.equal(isTrusted(by("renovate[bot]", "NONE", "本文", { type: "Bot" })), false);
  // ボットの名前を名乗る人のアカウントは、書き込める人かで決める
  assert.equal(isTrusted(by("claude[bot]", "NONE", "コメント", { type: "User" })), false);
  // 消えたアカウント
  assert.equal(isTrusted({ kind: "コメント", user: null, author_association: "NONE" }), false);
});

test("書き込めない人が書いた本文・コメント・レビューを拾う。空のレビューは数えない", () => {
  const items = [
    by("owner", "OWNER", "本文"),
    by("outsider", "NONE", "コメント"),
    by("drive-by", "CONTRIBUTOR", "レビュー", { body: "" }),
    by("drive-by2", "FIRST_TIMER", "レビュー", { body: "これも直して" }),
    by("line", "NONE", "レビューのコメント"),
  ];
  assert.deepEqual(
    untrustedIn(items).map((u) => `${u.kind}:${u.login}`),
    ["コメント:outsider", "レビュー:drive-by2", "レビューのコメント:line"],
  );
});

test("判定: 番号なしは通す・全部信じられれば通す・1つでも外の人なら止める・多すぎれば止める", () => {
  assert.equal(judge({ targets: [], found: [] }).ok, true);
  assert.equal(judge({ targets: [1], found: [{ number: 1, untrusted: [] }] }).ok, true);
  const bad = judge({
    targets: [1, 2],
    found: [
      { number: 1, untrusted: [] },
      { number: 2, untrusted: [{ kind: "本文", login: "outsider", association: "NONE" }] },
    ],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.lines.some((l) => l.includes("#2 の本文: @outsider(NONE)")));
  assert.ok(bad.lines.at(-1).includes("自分の言葉で新しい Issue"));
  const many = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => i + 1);
  assert.equal(judge({ targets: many, found: [] }).ok, false);
});

test("AI に読ませる文: 頼む文・題名・本文・コメント。当たれば AI を動かさない", () => {
  const texts = textsToRead({
    prompt: "#3 を直して",
    issues: [
      {
        number: 3,
        title: "題名",
        items: [
          { kind: "本文", body: "本文" },
          { kind: "コメント", body: "1つ目" },
          { kind: "コメント", body: "連絡は taro@gmail.com" },
          { kind: "レビュー", body: null },
        ],
      },
    ],
  });
  assert.deepEqual(
    texts.map((t) => t.where),
    [
      "頼む文",
      "#3 の題名",
      "#3 の本文",
      "#3 のコメント(1件目)",
      "#3 のコメント(2件目)",
      "#3 のレビュー(1件目)",
    ],
  );
  const bad = judgePii(hitLines(scanTexts(texts)));
  assert.equal(bad.ok, false);
  assert.ok(bad.lines.some((l) => l.startsWith("#3 のコメント(2件目) の 1行目")));
  assert.ok(bad.lines.every((l) => !l.includes("taro@gmail.com")));
  assert.equal(judgePii([]).ok, true);
});
