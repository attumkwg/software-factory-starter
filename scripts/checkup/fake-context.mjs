// テスト用の偽物の ctx(確かめ方に渡す物。本物は context.mjs)。GitHub とファイルを表で差し替える。
export const ok = (data) => ({ ok: true, data });
export const err = (status, message = `HTTP ${status}`) => ({ ok: false, status, message });
const NO_GH = { ok: false, status: 0, message: "gh が入っていない" };

/**
 * 偽物の ctx。api / gh は「パス → 応答」の表で答える(無ければ gh が無いのと同じ)。
 * 鍵は、パスそのもの・「?」の前まで・末尾の「*」で頭だけ のどれか。応答が関数なら、パスを渡して呼ぶ
 */
export function fakeCtx({ api = {}, gh = {}, files = {}, run = {}, today = "2026-10-22", ledger }) {
  const lookup = (table, path) => {
    const key = Object.keys(table)
      .filter(
        (k) =>
          path === k ||
          path.startsWith(`${k}?`) ||
          (k.endsWith("*") && path.startsWith(k.slice(0, -1))),
      )
      .sort((a, b) => b.length - a.length)[0];
    const res = key === undefined ? NO_GH : table[key];
    return typeof res === "function" ? res(decodeURIComponent(path)) : res;
  };
  return {
    repo: "o/r",
    today,
    ledger,
    api: (sub) => lookup(api, sub),
    gh: (path) => lookup(gh, path),
    run: (_cmd, args) => run[args.join(" ")] ?? { error: "no" },
    read: (p) => files[p],
    exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    files: (dir) =>
      Object.keys(files)
        .filter((f) => f.startsWith(`${dir}/`))
        .sort(),
  };
}
