// セットアップが GitHub を読む・書くための gh の呼び出し。持ち主の gh のログインで動く(Actions からは流さない)。
// 読むのも書くのも投げずに { ok, status, data, message } を返す(1つ読めなくても、ほかを続けるため。設計書 1.)。
import { execFileSync } from "node:child_process";
import { httpStatus } from "../checkup/gh.mjs";

const firstLine = (s) =>
  String(s ?? "")
    .trim()
    .split("\n")[0];

/** gh api を1回。body があれば JSON を標準入力で渡す */
export function ghCall(method, path, body, exec = execFileSync) {
  const args = ["api", "-X", method, "-H", "Accept: application/vnd.github+json", path];
  if (body !== undefined) args.push("--input", "-");
  try {
    const out = exec("gh", args, {
      encoding: "utf8",
      input: body === undefined ? undefined : JSON.stringify(body),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { ok: true, status: 200, data: out.trim() ? JSON.parse(out) : null };
  } catch (e) {
    if (e.code === "ENOENT") return { ok: false, status: 0, message: "gh が入っていない" };
    const text = `${e.stderr ?? ""}\n${e.stdout ?? ""}`;
    return { ok: false, status: httpStatus(text), message: firstLine(e.stderr || e.message) };
  }
}

/**
 * リポジトリ1つぶんの読み書き。テストでは同じ形の偽物(fake-github.mjs)を渡す。
 *   get(sub)              … GET repos/<repo>/<sub>(sub が空ならリポジトリそのもの)
 *   getPath(path)         … GET <path>(user・users/<login> など、リポジトリの外)
 *   write(method, sub, body) … POST / PUT / PATCH / DELETE repos/<repo>/<sub>
 */
export function makeGitHub(repo, call = ghCall) {
  const at = (sub) => `repos/${repo}${sub ? `/${sub}` : ""}`;
  return {
    repo,
    get: (sub) => call("GET", at(sub)),
    getPath: (path) => call("GET", path),
    write: (method, sub, body) => call(method, at(sub), body),
  };
}

/** 手元のリポジトリ(owner/name)。分からなければ undefined */
export function currentRepo(exec = execFileSync) {
  try {
    return (
      exec("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** 読めなかったときの1行(GitHub の1行目と HTTP の番号だけ。秘密は出ない) */
export const why = (res) => (res.status ? `HTTP ${res.status}: ${res.message}` : res.message);
