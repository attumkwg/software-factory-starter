// pnpm vulns の中身(vulns-lib.mjs)のテスト。node --test scripts/vulns.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { idsIn, isDate, latestById, parseVulns, triage } from "./vulns-lib.mjs";

const TODAY = "2026-10-22";
const HEAD = ["| 日付 | ID | パッケージ | 結果 | 理由 | 見直す日 |", "|---|---|---|---|---|---|"];
const table = (...rows) => [...HEAD, ...rows].join("\n");
const ESBUILD =
  "| 2026-10-22 | GHSA-67mh-4wv8-2f99 | esbuild | 入っているが届かない | 開発用 | 2027-01-22 |";
const alert = (number, ghsa, cve = null) => ({ number, ghsa, cve, pkg: "x", severity: "high" });

test("記録の表(docs/security/vulns.md)は書き方の問題が無い", () => {
  const { rows, problems } = parseVulns(readFileSync("docs/security/vulns.md", "utf8"));
  assert.deepEqual(problems, []);
  assert.ok(rows.length > 0);
});

test("日付の形", () => {
  assert.equal(isDate("2026-10-22"), true);
  assert.equal(isDate("2026-1-22"), false);
  assert.equal(isDate("2026-10-22-1"), false);
  assert.equal(isDate("—"), false);
});

test("リンクの中の ID も、大文字にそろえて1つにまとめる", () => {
  const ids = idsIn(
    "[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)・cve-2026-1234",
  );
  assert.deepEqual(ids, ["GHSA-67MH-4WV8-2F99", "CVE-2026-1234"]);
});

test("見出し・区切りの行は記録にしない", () => {
  const { rows, problems } = parseVulns(table(ESBUILD));
  assert.equal(rows.length, 1);
  assert.deepEqual(problems, []);
  assert.equal(rows[0].review, "2027-01-22");
});

test("書き方の問題: 列の数・結果・ID・理由・見直す日", () => {
  const { problems } = parseVulns(
    table(
      "| 2026-10-22 | GHSA-aaaa-bbbb-cccc | x | 該当なし | 理由 |",
      "| 2026-10-22 | GHSA-aaaa-bbbb-cccc | x | たぶん大丈夫 | 理由 | — |",
      "| 2026-10-22 | なし | x | 該当なし | 理由 | — |",
      "| 2026-10-22 | GHSA-aaaa-bbbb-cccc | x | 該当なし |  | — |",
      "| 2026-10-22 | GHSA-aaaa-bbbb-cccc | x | 入っているが届かない | 理由 | — |",
      "| 2026-10-22 | GHSA-aaaa-bbbb-cccc | x | 該当なし | 理由 | 来年 |",
    ),
  );
  const text = problems.join("\n");
  assert.match(text, /3行目 列の数/);
  assert.match(text, /4行目 結果「たぶん大丈夫」/);
  assert.match(text, /5行目 ID/);
  assert.match(text, /6行目 理由が無い/);
  assert.match(text, /7行目 「入っているが届かない」には見直す日/);
  assert.match(text, /8行目 見直す日「来年」/);
});

test("同じ ID はいちばん新しい行が今の結論", () => {
  const { rows } = parseVulns(
    table(
      "| 2026-10-22 | GHSA-aaaa-bbbb-cccc | x | 入っているが届かない | 開発用 | 2026-11-01 |",
      "| 2026-11-01 | GHSA-aaaa-bbbb-cccc | x | 届く・直した | 上げた | — |",
    ),
  );
  assert.equal(latestById(rows).get("GHSA-AAAA-BBBB-CCCC").result, "届く・直した");
  assert.deepEqual(triage({ rows, alerts: [], today: "2026-12-01" }).due, []);
});

test("記録にも下書きにも無い通知は、まだ精査していない", () => {
  const { rows } = parseVulns(table(ESBUILD));
  const result = triage({
    rows,
    alerts: [alert(1, "GHSA-67mh-4wv8-2f99"), alert(2, "GHSA-zzzz-yyyy-xxxx")],
    today: TODAY,
  });
  assert.deepEqual(
    result.untriaged.map((a) => a.number),
    [2],
  );
  assert.deepEqual(
    result.recorded.map((r) => r.alert.number),
    [1],
  );
});

test("CVE の ID で記録していても突き合わせる", () => {
  const { rows } = parseVulns(
    table("| 2026-10-22 | CVE-2026-1234 | x | 該当なし | 入っていない | — |"),
  );
  const result = triage({
    rows,
    alerts: [alert(3, "GHSA-zzzz-yyyy-xxxx", "CVE-2026-1234")],
    today: TODAY,
  });
  assert.equal(result.untriaged.length, 0);
  assert.equal(result.recorded.length, 1);
});

test("非公開の下書きの本文に ID があれば、精査済み(非公開)として数える", () => {
  const result = triage({
    rows: [],
    alerts: [alert(4, "GHSA-zzzz-yyyy-xxxx")],
    drafts: [{ summary: "依存の穴", description: "元の勧告: GHSA-zzzz-yyyy-xxxx" }],
    today: TODAY,
  });
  assert.equal(result.untriaged.length, 0);
  assert.deepEqual(
    result.privately.map((a) => a.number),
    [4],
  );
});

test("見直す日が来た・過ぎた記録を出す(当日も含む)", () => {
  const { rows } = parseVulns(table(ESBUILD));
  assert.equal(triage({ rows, alerts: [], today: "2027-01-21" }).due.length, 0);
  assert.equal(triage({ rows, alerts: [], today: "2027-01-22" }).due.length, 1);
});

test("通知を確かめられないとき(alerts が undefined)は、記録の側だけを見る", () => {
  const { rows } = parseVulns(table(ESBUILD));
  const result = triage({ rows, alerts: undefined, today: "2027-02-01" });
  assert.equal(result.untriaged.length, 0);
  assert.equal(result.due.length, 1);
});
