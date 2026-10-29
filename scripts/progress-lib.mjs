// 依頼ごとの進み具合の管制(中身だけ。読み書きは progress.mjs)。仕様 0086。
// 親 Issue(印 kind:feature)の本文の「子の一覧」から、n/m・依存の順番・完成の判定・止まった PR を出す。
// 子の一覧の書き方(/new-feature が作る): 1行に子が1つ。「待つ: #番号」で、先に閉じる子を書く。
//   1. #12 スキーマを足す
//   2. #13 API(待つ: #12)
//   3. #14 画面(待つ: #12・#13)

/** 止まったと見る日数(PR が更新されない・進められる子に PR が無い) */
export const STALL_DAYS = 2;

/** 親 Issue の本文に書く進み具合の囲い */
export const START = "<!-- progress:start -->";
export const END = "<!-- progress:end -->";

const DAY = 24 * 3600 * 1000;
const numbers = (text) => [...String(text).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

/**
 * 親の本文から子の並び({ number, title, waits })。進み具合の囲いの中は読まない。
 * 子の行 = 箇条書き(「- 」「1. 」「- [ ] 」)で、頭に #番号 がある行
 */
export function childrenOf(body) {
  const text = String(body ?? "");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  const outside = a >= 0 && b > a ? text.slice(0, a) + text.slice(b + END.length) : text;
  const out = [];
  for (const raw of outside.split("\n")) {
    const line = raw.trim().replace(/^(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, "");
    if (line === raw.trim() || !line.startsWith("#")) continue;
    const number = Number(line.slice(1).split(/\D/)[0]);
    if (!number || out.some((c) => c.number === number)) continue;
    const at = line.indexOf("待つ:");
    const waits = at >= 0 ? numbers(line.slice(at)).filter((n) => n !== number) : [];
    const title = line
      .slice(String(number).length + 1)
      .replace(/[(（]待つ:.*$/, "")
      .trim();
    out.push({ number, title, waits });
  }
  return out;
}

/** 依存の問題(一覧に無い子を待つ・輪になっている)。空なら良い */
export function orderProblems(children) {
  const ids = new Set(children.map((c) => c.number));
  const problems = [];
  for (const c of children)
    for (const w of c.waits)
      if (!ids.has(w)) problems.push(`#${c.number} が待つ #${w} は子の一覧に無い`);
  const waitsOf = new Map(children.map((c) => [c.number, c.waits.filter((w) => ids.has(w))]));
  const state = new Map();
  const visit = (n, path) => {
    if (state.get(n) === "done") return;
    if (state.get(n) === "doing") {
      problems.push(`依存が輪になっている: ${[...path, n].map((x) => `#${x}`).join(" → ")}`);
      return;
    }
    state.set(n, "doing");
    for (const w of waitsOf.get(n) ?? []) visit(w, [...path, n]);
    state.set(n, "done");
  };
  for (const c of children) visit(c.number, []);
  return problems;
}

/** PR の本文の「Closes #n」「Fixes #n」「Resolves #n」の番号 */
export const closesOf = (body) =>
  [...String(body ?? "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map(
    (m) => Number(m[1]),
  );

const daysSince = (iso, now) => Math.floor((now - new Date(iso)) / DAY);

/** 止まった物: 2日動いていない PR と、進められるようになって2日 PR が無い子 */
function stalledOf({ open, ready, issues, prs, now }) {
  const prsOf = (n) => prs.filter((p) => closesOf(p.body).includes(n));
  const stalled = [];
  for (const c of open)
    for (const p of prsOf(c.number)) {
      const days = daysSince(p.updated_at, now);
      if (days >= STALL_DAYS)
        stalled.push({ child: c.number, pr: p.number, days, why: `PR が ${days} 日動いていない` });
    }
  for (const c of ready.filter((r) => prsOf(r.number).length === 0)) {
    // 進められるようになった日 = 待つ子のいちばん遅い閉じた日(待たなければ子を作った日)
    const since = c.waits.map((w) => issues.get(w)?.closed_at).filter(Boolean);
    const from = since.length > 0 ? since.sort().at(-1) : issues.get(c.number)?.created_at;
    const days = from ? daysSince(from, now) : 0;
    if (days >= STALL_DAYS)
      stalled.push({ child: c.number, days, why: `進められるのに ${days} 日 PR が無い` });
  }
  return stalled;
}

const statusOf = (total, openCount, accepted) => {
  if (total === 0) return "子の一覧が無い";
  if (openCount > 0) return "進行中";
  return accepted ? "完成" : "受け入れ待ち";
};

/**
 * 親1つの進み具合。issues は子の番号 → { state, closed_at, created_at }、prs は開いた PR({ number, body, updated_at, draft })、
 * accepted は受け入れの記録({ path, date })か undefined
 */
export function progressOf({ parent, issues, prs, accepted, now = new Date() }) {
  const children = childrenOf(parent.body);
  const problems = orderProblems(children);
  const closed = (n) => issues.get(n)?.state === "closed";
  const done = children.filter((c) => closed(c.number));
  const open = children.filter((c) => !closed(c.number));
  const ready = open.filter((c) => c.waits.every(closed));
  const waiting = open.filter((c) => !c.waits.every(closed));
  const stalled = stalledOf({ open, ready, issues, prs, now });
  const status = statusOf(children.length, open.length, accepted);
  const end = status === "完成" ? new Date(`${accepted.date}T00:00:00+09:00`) : now;
  return {
    number: parent.number,
    title: parent.title,
    status,
    done: done.length,
    total: children.length,
    ready: ready.map((c) => c.number),
    waiting: waiting.map((c) => ({ number: c.number, on: c.waits.filter((w) => !closed(w)) })),
    stalled,
    problems,
    days: Math.max(0, daysSince(parent.created_at, end)),
    accepted: accepted?.path,
  };
}

/** 親の本文に書く進み具合(囲いの中身) */
export function renderBlock(p, today) {
  const lines = [
    START,
    `### 📍 進み具合(${today}・\`pnpm progress\` が書く。手で直さない)`,
    "",
    `- **${p.done}/${p.total}**・${p.status}・依頼から ${p.days} 日`,
  ];
  if (p.ready.length > 0) lines.push(`- 次に進められる: ${p.ready.map((n) => `#${n}`).join("・")}`);
  for (const w of p.waiting)
    lines.push(`- #${w.number} は ${w.on.map((n) => `#${n}`).join("・")} を待つ`);
  for (const s of p.stalled)
    lines.push(`- ⏸ 止まっている: #${s.child}${s.pr ? ` の PR #${s.pr}` : ""}(${s.why})`);
  for (const pr of p.problems) lines.push(`- ⚠️ ${pr}`);
  if (p.status === "受け入れ待ち")
    lines.push("- 子は全部閉じた。`/accept` で受け入れ、記録の頭に「親 Issue: #番号」を書くと完成");
  if (p.status === "完成") lines.push(`- ✅ 受け入れ: ${p.accepted}`);
  lines.push(END);
  return lines.join("\n");
}

/** 本文の囲いを差し替える(無ければ末尾に足す) */
export function withBlock(body, block) {
  const text = String(body ?? "");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + END.length);
  return `${text.trimEnd()}\n\n${block}\n`;
}

/** 受け入れの記録の本文から、指している親 Issue の番号と最後の回の日付 */
export function acceptanceOf(md) {
  const parent = String(md).match(/親 Issue:\s*#(\d+)/)?.[1];
  const dates = [...String(md).matchAll(/^## 第\d+回 (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]);
  return { parent: parent ? Number(parent) : undefined, date: dates.at(-1) };
}

/** 中央値(空なら undefined) */
export const median = (xs) => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 開いている親の一覧と、届くまでの日数(all = 8週のうちに閉じた親も入れた並び) */
export function renderSummary(list, today, all = list) {
  const lines = [`# 📍 依頼ごとの進み具合(${today})`, ""];
  if (list.length === 0) lines.push("開いている依頼(印 kind:feature の親 Issue)はありません。");
  else {
    lines.push("| 依頼 | 済み | 状態 | 日数 | 次 | 止まった |", "|---|---|---|---|---|---|");
    for (const p of list) {
      const what = `#${p.number} ${p.title}`.replaceAll("|", "/").slice(0, 50);
      const next = p.ready.map((n) => `#${n}`).join("・") || "—";
      lines.push(
        `| ${what} | ${p.done}/${p.total} | ${p.status} | ${p.days} | ${next} | ${p.stalled.length} |`,
      );
    }
  }
  const days = median(all.filter((p) => p.status === "完成").map((p) => p.days));
  lines.push(
    "",
    `- 依頼から届くまで(8週のうちに完成した物の中央値): ${days === undefined ? "まだ" : `${days} 日`}`,
  );
  return lines.join("\n");
}
