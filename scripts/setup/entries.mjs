// 差分の1行の形。区分(areas-*.mjs)が作り、plan.mjs が並べて出し、--apply のときに apply を順に流す。
//   state: ok(そろっている)/ add(足す)/ change(直す)/ remove(外す)/ extra(一覧に無い。表示だけ)/
//          skip(飛ばす。理由つき)/ unknown(読めなかった)/ todo(人がやること)
import { why } from "./github.mjs";

export const ok = (text) => ({ state: "ok", text });
export const add = (text, apply) => ({ state: "add", text, apply });
export const change = (text, apply) => ({ state: "change", text, apply });
export const remove = (text, apply) => ({ state: "remove", text, apply });
export const extra = (text) => ({ state: "extra", text });
export const skip = (text) => ({ state: "skip", text });
export const unknown = (what, res) => ({
  state: "unknown",
  text: `${what}を読めなかった(${why(res)})`,
});
export const todo = (text) => ({ state: "todo", text });

/** 反映が要る行か */
export const isDiff = (e) => typeof e.apply === "function";

/** 値を短く見せる(配列は「・」でつなぐ) */
export const show = (v) =>
  Array.isArray(v)
    ? v.join("・") || "(無し)"
    : v === undefined || v === null
      ? "(無し)"
      : String(v);

/** 鍵ごとの今とあるべきの違い: [{ key, now, want }] */
export function differences(now, want) {
  return Object.entries(want)
    .filter(([k, v]) => JSON.stringify(now?.[k]) !== JSON.stringify(v))
    .map(([key, v]) => ({ key, now: now?.[key], want: v }));
}

/** 違いを「鍵: 今 → あるべき」の1行に */
export const describe = (diffs) =>
  diffs.map((d) => `${d.key}: ${show(d.now)} → ${show(d.want)}`).join("、");
