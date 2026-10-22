// w-secrets: secret scanning の開いている見つけ物が無いか。中身(どの鍵か・どこか)は出さず、件数と見る場所だけ。
// gitleaks は CI の必須の検査(秘密情報)で毎回見ているので、ここでは見ない。
import { unknownFrom } from "../gh.mjs";

export async function check(ctx) {
  const res = ctx.api("secret-scanning/alerts?state=open&per_page=100");
  if (!res.ok && res.status === 404)
    return { result: "fail", note: "secret scanning がオフ(dep-alerts)" };
  if (!res.ok) return unknownFrom(res, "secret scanning の見つけ物");
  const n = (res.data ?? []).length;
  return n === 0
    ? { result: "pass", note: "開いている見つけ物は0件" }
    : {
        result: "fail",
        note: `開いている見つけ物 ${n}件(Security → Secret scanning で見る。docs/runbooks/secret-leak.md)`,
      };
}
