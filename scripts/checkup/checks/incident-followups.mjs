// incident-followups: 障害の振り返り(docs/incidents/*.md)の「再発防止」の Issue が全部閉じたか。
import { unknownFrom } from "../gh.mjs";
import { digitsAt } from "../text.mjs";

export const DIR = "docs/incidents";

/** 「## 再発防止」の節(次の「## 」まで)の文 */
export function followupSection(text) {
  const lines = String(text).replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith("## 再発防止"));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** 文の中の Issue の番号(#12 や …/issues/12) */
export function issueNumbers(text) {
  const nums = new Set();
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const after = s[i] === "#" ? i + 1 : s.startsWith("/issues/", i) ? i + 8 : -1;
    const n = after < 0 ? "" : digitsAt(s, after);
    if (n) nums.add(Number(n));
  }
  return [...nums];
}

export async function check(ctx) {
  const files = ctx
    .files(DIR)
    .filter((f) => f.endsWith(".md") && !f.endsWith("/README.md") && !f.includes("/_"));
  const nums = [...new Set(files.flatMap((f) => issueNumbers(followupSection(ctx.read(f)))))];
  if (nums.length === 0)
    return { result: "pass", note: `再発防止の Issue は無い(振り返り ${files.length}件)` };
  let open = 0;
  for (const n of nums) {
    const res = ctx.api(`issues/${n}`);
    if (!res.ok) return unknownFrom(res, `Issue #${n}`);
    if (res.data?.state === "open") open += 1;
  }
  return open === 0
    ? { result: "pass", note: `再発防止の Issue ${nums.length}件が全部閉じている` }
    : { result: "fail", note: `再発防止の Issue ${nums.length}件のうち ${open}件が開いている` };
}
