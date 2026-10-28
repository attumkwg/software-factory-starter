import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  parseVerdict,
  rangeOf,
  roiText,
  verdictProblems,
  verdictResult,
  verdictSummary,
} from "./verdict-lib.mjs";

const card = (over = {}) => {
  const f = {
    日付: "2026-10-29",
    場面: "アイデア",
    判断: "やる",
    意義: "小さな工務店の現場監督が、催促の連絡に使う時間が週5時間 → 1時間に減る(打ち合わせの記録で数える)",
    "動かす KPI": "K-1",
    見込み: "40〜60(2027-01-31 まで)",
    費用の見込み: "4〜8 人日",
    "得る物の見込み(月)": "2〜4 人日相当",
    測る月数: "6",
    止める線: "8週で K-1 が 20 を下回ったらやめる",
    人に聞く問い: "なし",
    実測: "",
    人の判定: "未定",
    ...over,
  };
  const cost = rangeOf(f.費用の見込み);
  const gain = rangeOf(f["得る物の見込み(月)"]);
  const roi =
    over["ROI の見込み"] ??
    (cost && gain ? roiText({ cost, gain, months: Number(f.測る月数) }) : "");
  return [
    "# 意義の判断: 朝のまとめ",
    ...Object.entries({ ...f, "ROI の見込み": roi }).map(([k, v]) => `- ${k}: ${v}`),
  ].join("\n");
};
const ids = new Set(["K-0", "K-1"]);

test("形の合った記録は通る。ROI は費用と得る物から出す(倍率と月数だけ)", () => {
  assert.deepEqual(verdictProblems(card(), ids), []);
  assert.equal(
    roiText({ cost: { low: 4, high: 8 }, gain: { low: 2, high: 4 }, months: 6 }),
    "0.5〜5.0 倍・回収 1.0〜4.0 か月",
  );
  assert.equal(
    roiText({ cost: { low: 1, high: 2 }, gain: { low: 0, high: 1 }, months: 3 }),
    "-1.0〜2.0 倍・回収 1.0〜回収しない か月",
  );
});

test("歯止め1: やる・条件つきで、意義を数で言えなければ落とす。やらないなら数は要らない", () => {
  const vague = card({ 意義: "みんなが便利になる" });
  assert.match(verdictProblems(vague, ids).join("\n"), /数で言えなければ「やらない」/);
  assert.match(
    verdictProblems(card({ 判断: "条件つき", 意義: "社会の役に立つ" }), ids).join("\n"),
    /数で/,
  );
  const no = [
    "- 日付: 2026-10-29",
    "- 場面: アイデア",
    "- 判断: やらない",
    "- 意義: 誰の困りごとかが言えない",
    "- 人に聞く問い: なし",
    "- 人の判定: 未定",
  ].join("\n");
  assert.deepEqual(verdictProblems(no, ids), []);
});

test("歯止め2: ROI の根拠が無い・手で上げた ROI・止める線が無い・木に無い KPI を落とす", () => {
  assert.match(verdictProblems(card({ 費用の見込み: "" }), ids).join("\n"), /ROI の根拠/);
  assert.match(
    verdictProblems(card({ "ROI の見込み": "10〜20 倍・回収 0.1〜0.2 か月" }), ids).join("\n"),
    /手で上げない/,
  );
  assert.match(verdictProblems(card({ 止める線: "" }), ids).join("\n"), /止める線/);
  assert.match(verdictProblems(card({ "動かす KPI": "K-9" }), ids).join("\n"), /K-9/);
  assert.match(verdictProblems(card({ 見込み: "たくさん" }), ids).join("\n"), /見込み/);
  // キット自身の記録は K- でない KPI でよい(実測は手で書く)
  assert.deepEqual(verdictProblems(card({ "動かす KPI": "1件の依頼で人が呼ばれる回数" }), ids), []);
});

test("人に聞く問いは1つまで。判断・場面・人の判定の言葉を確かめる", () => {
  const two = card({ 人に聞く問い: "値段は上げてよいか? 期限は延ばしてよいか?" });
  assert.match(verdictProblems(two, ids).join("\n"), /1つまで/);
  assert.match(verdictProblems(card({ 判断: "たぶん" }), ids).join("\n"), /判断/);
  assert.match(verdictProblems(card({ 場面: "雑談" }), ids).join("\n"), /場面/);
  assert.match(verdictProblems(card({ 人の判定: "よかった" }), ids).join("\n"), /人の判定/);
  assert.deepEqual(verdictProblems(card({ 人の判定: "正しかった @owner 2027-02-01" }), ids), []);
});

test("歯止め3: 期限の後に実測と比べ、判断役の当たり率と、人の判定を待つ記録を出す", () => {
  const v = parseVerdict(card());
  const rec = (value, date = "2027-01-20") => [{ kpi: "K-1", date, value }];
  assert.equal(verdictResult(v, rec(50), "2026-12-01"), "まだ");
  assert.equal(verdictResult(v, [], "2027-02-01"), "測っていない");
  assert.equal(verdictResult(v, rec(50), "2027-02-01"), "当たり");
  assert.equal(verdictResult(v, rec(80), "2027-02-01"), "当たり"); // 見込みより良い
  assert.equal(verdictResult(v, rec(30), "2027-02-01"), "外れ");
  assert.equal(verdictResult(v, rec(50, "2027-03-01"), "2027-04-01"), "測っていない"); // 期限の後の記録は数えない
  assert.equal(verdictResult(v, rec(70), "2027-02-01", "below"), "外れ"); // 少ないほど良い指標
  assert.equal(verdictResult(parseVerdict(card({ 実測: "45" })), [], "2027-02-01"), "当たり");
  assert.equal(
    verdictResult(parseVerdict(card({ 判断: "やらない" })), [], "2027-02-01"),
    "比べない",
  );

  const s = verdictSummary([
    { path: "a.md", v, result: "外れ" },
    { path: "b.md", v, result: "外れ" },
    { path: "c.md", v: { ...v, judged: "正しかった @o 2027-02-01" }, result: "当たり" },
    { path: "d.md", v, result: "まだ" },
  ]);
  assert.deepEqual([s.hits, s.checked, s.review], [1, 3, true]);
  assert.deepEqual(
    s.waiting.map((w) => w.split(":")[0]),
    ["a.md", "b.md"],
  );
});

test("キットの記録(docs/product/verdicts・docs/kit/verdicts)は形が合っている", () => {
  for (const dir of ["docs/product/verdicts", "docs/kit/verdicts"]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md") && !x.startsWith("_")))
      assert.deepEqual(verdictProblems(readFileSync(`${dir}/${f}`, "utf8")), [], f);
  }
});
