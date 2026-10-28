import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { humanOnlyReasons } from "./pr-merge-lib.mjs";
import {
  highWordsFromLine,
  parseMediumPlaces,
  parseRiskAreas,
  riskAreaProblems,
  touchedAreas,
} from "./risk-areas-lib.mjs";

const read = (f) => readFileSync(f, "utf8");
const doc = read("docs/concepts/risk-areas.md");
const areas = parseRiskAreas(doc);
const { paths: protectedPaths } = JSON.parse(read(".claude/hooks/protected-paths.json"));
const real = {
  areas,
  medium: parseMediumPlaces(doc),
  highWords: highWordsFromLine(read("docs/concepts/line.md")),
  protectedPaths,
  apiDirs: readdirSync("apps/api/src", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name),
  exists: existsSync,
};

test("キットの表は、line.md の「高」・守る場所の一覧・apps/api/src の場所とそろっている", () => {
  assert.deepEqual(riskAreaProblems(real), []);
  assert.ok(real.highWords.includes("課金"));
  assert.ok(areas.every((a) => a.question.length > 0));
});

test("2026-10-29 の穴: 課金・個人データ・SSO・メールのセンサーが守る場所に入っている", () => {
  for (const dir of ["plans", "person-data", "export", "sso", "mail", "usage", "offboarding"]) {
    const area = areas.find((a) => a.code.includes(`apps/api/src/${dir}/**`));
    assert.ok(area, dir);
    assert.ok(area.guarded.length > 0, dir);
  }
});

test("ずれを見つける: 守る場所に無い・line.md の言葉が無い・決めていない場所・問いが無い", () => {
  const area = {
    area: "課金",
    name: "課金",
    guarded: ["a.test.ts"],
    code: ["src/x/**"],
    question: "",
  };
  const problems = riskAreaProblems({
    areas: [area],
    medium: ["apps/api/src/demo/**"],
    highWords: ["課金", "個人データ"],
    protectedPaths: [],
    apiDirs: ["demo", "plans"],
    exists: (p) => p !== "src/x",
  });
  assert.deepEqual(problems, [
    "line.md の「高」の「個人データ」が risk-areas.md の 1 の表に無い",
    "課金 の守る場所 a.test.ts が protected-paths.json に無い",
    "課金 のコード src/x/** が無い",
    "課金 に聞く問いが無い",
    "apps/api/src/plans/** が risk-areas.md の「高」にも「中」にも無い(どちらかに決める)",
  ]);
  assert.match(riskAreaProblems({ ...real, areas: [] })[0], /読めない/);
  assert.ok(
    riskAreaProblems({ ...real, highWords: [...real.highWords.filter((w) => w !== "課金")] }).some(
      (p) => p.includes("「課金」が line.md"),
    ),
  );
});

test("課金のテストを変えた PR は AI がマージせず、課金の問いを返す。コードだけなら問いは無い", () => {
  const files = ["apps/api/test/integration/plans.int.test.ts", "apps/api/src/plans/command.ts"];
  const touched = touchedAreas(files, areas);
  assert.deepEqual(
    touched.map((a) => a.area),
    ["課金"],
  );
  assert.match(touched[0].question, /契約・請求/);
  assert.equal(humanOnlyReasons({ labels: [], files, protectedPaths }).length, 1);
  const codeOnly = ["apps/api/src/plans/command.ts", "apps/api/src/mail/mailer.ts"];
  assert.deepEqual(touchedAreas(codeOnly, areas), []);
  assert.deepEqual(humanOnlyReasons({ labels: [], files: codeOnly, protectedPaths }), []);
});
