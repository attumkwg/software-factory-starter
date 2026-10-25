// 点検が GitHub を読むための gh の呼び出し。読むだけ(GET)。
// CHECKUP_READ_TOKEN があれば、読むときだけそれを使う(読み取り専用の細かい権限のトークン。Issue を書くトークンと分ける。設計書 5.)。
// gh が無い・ログインしていない・権限が無いときは投げずに { ok: false, status, message } を返し、
// 確かめ1つの結果を unknown にする(全体は止めない。設計書 8. の「壊れたとき」)。
import { execFileSync } from "node:child_process";

/** gh のエラーの文から HTTP の番号を取り出す(「… (HTTP 404)」)。無ければ 0 */
export function httpStatus(text) {
  const at = String(text).lastIndexOf("(HTTP ");
  if (at < 0) return 0;
  return Number.parseInt(String(text).slice(at + 6, at + 9), 10) || 0;
}

/** 読むときの環境(CHECKUP_READ_TOKEN があれば GH_TOKEN をそれに替える) */
export const readEnv = (env = process.env) =>
  env.CHECKUP_READ_TOKEN ? { ...env, GH_TOKEN: env.CHECKUP_READ_TOKEN } : env;

const firstLine = (s) =>
  String(s ?? "")
    .trim()
    .split("\n")[0];

/**
 * gh api <path> を呼び、JSON を返す。
 * 戻り値: { ok: true, data } か { ok: false, status(HTTP の番号。gh が無いなど HTTP の外なら 0), message }
 */
export function ghApi(path) {
  try {
    const out = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], {
      encoding: "utf8",
      env: readEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      // 実行の一覧(100件)などは 1MB(既定)を超える
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, data: out.trim() ? JSON.parse(out) : null };
  } catch (e) {
    if (e.code === "ENOENT") return { ok: false, status: 0, message: "gh が入っていない" };
    const text = `${e.stderr ?? ""}\n${e.stdout ?? ""}`;
    return { ok: false, status: httpStatus(text), message: firstLine(e.stderr || e.message) };
  }
}

/** 確かめるリポジトリ(owner/name)。Actions では GITHUB_REPOSITORY、手元では gh repo view。分からなければ undefined */
export function resolveRepo(env = process.env) {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  try {
    return (
      execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** gh の失敗を、確かめの結果(unknown)にする。秘密や見つけ物の中身は出さない(gh の1行目だけ) */
export const unknownFrom = (res, what) => ({
  result: "unknown",
  note: `${what}を読めなかった(${res.status ? `HTTP ${res.status}` : res.message})`,
});
