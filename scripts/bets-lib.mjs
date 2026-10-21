// 賭け(docs/product/bets/B-NNNN-*.md)と PR の本文を読んで確かめる中身。入口は bets.mjs。
// 決まりは docs/guides/bets-and-assets.md。Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

export const STAGES = ["idea", "cpf", "psf", "rollout", "adopted", "retired", "dropped"];
const TESTED = ["cpf", "psf", "rollout"];
const NEXT = { idea: "cpf", cpf: "psf", psf: "rollout", rollout: "adopted" };
const PREV = { cpf: "idea", psf: "cpf", rollout: "psf" };
const DECISIONS = [
  "開く",
  "続ける",
  "進む",
  "飛ばす",
  "変える",
  "戻る",
  "線を動かす",
  "やめる",
  "撤去する",
];
// 結果を見て決める判断。この段階の線が、先に決まっていないといけない
const NEEDS_LINE = ["続ける", "進む", "変える", "戻る", "線を動かす"];
const CATEGORIES = ["費用", "資産の候補", "除却の候補"];
export const WORKS = ["保守", "不具合", "基盤", "セキュリティ"];
export const KINDS = ["探索", "作り込み", "保守", "撤去"];

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");
export const isDate = (s) => {
  const [y, m, d, rest] = s.split("-");
  return rest === undefined && y?.length === 4 && m?.length === 2 && d?.length === 2
    ? isDigits(y) && isDigits(m) && isDigits(d)
    : false;
};
const isBetId = (s) => s.length === 6 && s.startsWith("B-") && isDigits(s.slice(2));

// 「B-0001-task-mail.md」から「B-0001」。形が違えば undefined
export const idOfFile = (file) => {
  const id = file.slice(0, 6);
  const ok = isBetId(id) && file[6] === "-" && file.length > 10 && file.endsWith(".md");
  return ok ? id : undefined;
};

// <!-- … --> を消す(テンプレートの説明の中の例を、値として読まないように)
export const stripComments = (text) => {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open < 0) return out + text.slice(at);
    out += text.slice(at, open);
    const close = text.indexOf("-->", open);
    if (close < 0) return out;
    at = close + 3;
  }
};

const cellsOf = (line) =>
  line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
const isTableLine = (line) => line.startsWith("|") && line.endsWith("|");
const isSeparator = (cells) => cells.every((c) => c.length > 0 && [...c].every((x) => x === "-"));

// 見出し(## …)ごとに、表の行(見出しの行と区切りの行は除く)と行番号を集める
const parseSections = (lines) => {
  const sections = [];
  let current;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      current = { title: line.slice(3), heading: i + 1, rows: [], header: undefined, status: [] };
      sections.push(current);
      return;
    }
    if (!current) return;
    if (!isTableLine(line)) {
      if (line.startsWith("- ")) current.status.push(line.slice(2));
      return;
    }
    const cells = cellsOf(line);
    if (!current.header) current.header = cells;
    else if (!isSeparator(cells)) current.rows.push({ cells, at: i + 1 });
  });
  return sections;
};

export const parseBet = (text) => {
  const lines = stripComments(text).split("\n");
  const sections = parseSections(lines);
  const find = (head) => sections.find((s) => s.title.startsWith(head));
  const status = find("いまの状態");
  const stageLine = status?.status.find((s) => s.startsWith("段階:"));
  const title = lines.find((l) => l.startsWith("# "));
  return {
    title: title?.slice(2).trim() ?? "",
    stage: stageLine?.slice(3).trim(),
    parent: status?.status
      .find((s) => s.startsWith("親:"))
      ?.slice(2)
      .trim(),
    lines: find("線と期限"),
    pebbles: find("小石"),
    ledger: find("会計区分"),
  };
};

const toLine = ({ cells, at }) => ({
  stage: cells[0],
  due: cells[4],
  decided: cells[5],
  at,
  size: cells.length,
});
const toPebble = ({ cells, at }) => ({
  date: cells[0],
  stage: cells[1],
  decision: cells[4] ?? "",
  at,
  size: cells.length,
});

const checkLineRows = (rows, problems) => {
  for (const r of rows) {
    if (r.size !== 6) problems.push(`${r.at}行目: 線と期限の列の数が6ではない(${r.size})`);
    else if (!TESTED.includes(r.stage) && r.stage !== "adopted")
      problems.push(`${r.at}行目: 線を決める段階は cpf / psf / rollout / adopted(「${r.stage}」)`);
    else if (!isDate(r.due) || !isDate(r.decided))
      problems.push(`${r.at}行目: 期限と決めた日は YYYY-MM-DD で`);
  }
};

// 判断を1つ当てたあとの段階。当てられなければ undefined
const apply = (cur, head) => {
  if (["開く", "続ける", "変える", "線を動かす"].includes(head)) return cur;
  if (head === "進む") return NEXT[cur];
  if (head === "飛ばす") return TESTED.includes(cur) ? NEXT[cur] : undefined;
  if (head === "戻る") return PREV[cur];
  if (head === "やめる") return NEXT[cur] ? "dropped" : undefined;
  if (head === "撤去する") return cur === "adopted" ? "retired" : undefined;
  return undefined;
};

// 小石の形(列・日付・判断の言葉)。問題があれば文を返す
const shapeProblem = (p, ctx, head) => {
  if (p.size !== 6) return `列の数が6ではない(${p.size})`;
  if (!isDate(p.date)) return `日付「${p.date}」は YYYY-MM-DD で`;
  if (p.date < ctx.lastDate) return "日付が前の行より古い(小石は足すだけ・古い順)";
  if (!head) return `判断「${p.decision}」は ${DECISIONS.join(" / ")} のどれかで始める`;
  if (ctx.first && head !== "開く") return "最初の小石は「開く」(段階 idea)";
  if (!ctx.first && head === "開く") return "「開く」は最初の1行だけ";
  return undefined;
};

// 小石を1行ずつ確かめて、段階を進める。問題があれば文を返す
const checkPebble = (p, ctx) => {
  const head = DECISIONS.find((d) => p.decision.startsWith(d));
  const shape = shapeProblem(p, ctx, head);
  if (shape) return shape;
  if (p.stage !== ctx.cur)
    return `段階「${p.stage}」は、ここまでの判断をたどった段階「${ctx.cur}」と合わない(飛ばすなら「飛ばす」の小石を)`;
  if (head === "線を動かす" && !p.decision.includes("@"))
    return "線を動かすのは本人の判断。「線を動かす(@名前)」と名前を残す";
  if (NEEDS_LINE.includes(head) && TESTED.includes(p.stage)) {
    const ok = ctx.lines.some((l) => l.stage === p.stage && l.decided <= p.date);
    if (!ok) return `${p.stage} の線と期限が、この結果(${p.date})より前に決まっていない`;
  }
  const next = apply(ctx.cur, head);
  if (!next) return `段階 ${ctx.cur} では「${head}」はできない`;
  ctx.moves[p.stage] = (ctx.moves[p.stage] ?? 0) + (head === "線を動かす" ? 1 : 0);
  ctx.cur = next;
  ctx.visited.add(next);
  return undefined;
};

const walkPebbles = (rows, lines, problems) => {
  const ctx = { cur: "idea", first: true, lastDate: "", lines, moves: {}, visited: new Set() };
  ctx.visited.add("idea");
  for (const p of rows) {
    const problem = checkPebble(p, ctx);
    if (problem) {
      problems.push(`${p.at}行目: ${problem}`);
      return ctx;
    }
    ctx.first = false;
    ctx.lastDate = p.date;
  }
  if (ctx.first) problems.push("小石が1つも無い(最初は「開く」)");
  return ctx;
};

const checkMoves = (lines, ctx, problems) => {
  for (const stage of new Set(lines.map((l) => l.stage))) {
    const extra = lines.filter((l) => l.stage === stage).length - 1;
    if (extra > (ctx.moves[stage] ?? 0))
      problems.push(`${stage} の線が ${extra + 1} 行あるのに「線を動かす(@名前)」の小石が足りない`);
  }
};

const checkLedger = (ledger, visited, problems) => {
  const rows = ledger?.rows ?? [];
  for (const { cells, at } of rows) {
    const [date, , category, , who] = cells;
    if (cells.length !== 5)
      problems.push(`${at}行目: 会計区分の列の数が5ではない(${cells.length})`);
    else if (!isDate(date)) problems.push(`${at}行目: 会計区分の日付は YYYY-MM-DD で`);
    else if (!CATEGORIES.some((c) => category.startsWith(c)))
      problems.push(`${at}行目: 区分の案は ${CATEGORIES.join(" / ")} のどれかで始める`);
    else if (who !== "未確定" && !who.startsWith("@"))
      problems.push(`${at}行目: 確定した人は「未確定」か「@名前 YYYY-MM-DD」`);
  }
  for (const stage of visited) {
    if (!rows.some((r) => r.cells[1] === stage))
      problems.push(`段階 ${stage} の会計区分の判定(案)の行が無い`);
  }
};

// 1つの賭けを確かめる。problems は CI を落とす物。due・noLine は一覧に出すだけ
export const checkBet = (bet, today) => {
  const problems = [];
  if (!STAGES.includes(bet.stage ?? ""))
    problems.push(`いまの状態の段階「${bet.stage}」は ${STAGES.join(" / ")} のどれか`);
  for (const [name, s] of [
    ["線と期限", bet.lines],
    ["小石", bet.pebbles],
    ["会計区分の判定", bet.ledger],
  ]) {
    if (!s) problems.push(`「## ${name}」の見出しが無い`);
  }
  if (problems.length > 0) return { problems };
  const [linesAt, pebblesAt] = [bet.lines.heading, bet.pebbles.heading];
  if (pebblesAt < linesAt) problems.push("「線と期限」は「小石」より前に書く");
  const lines = bet.lines.rows.map(toLine);
  checkLineRows(lines, problems);
  const ctx = walkPebbles(bet.pebbles.rows.map(toPebble), lines, problems);
  if (problems.length > 0) return { problems };
  if (ctx.cur !== bet.stage)
    problems.push(`いまの状態の段階「${bet.stage}」が、小石をたどった段階「${ctx.cur}」と合わない`);
  checkMoves(lines, ctx, problems);
  checkLedger(bet.ledger, ctx.visited, problems);
  const latest = lines.filter((l) => l.stage === ctx.cur).at(-1);
  const testing = TESTED.includes(ctx.cur);
  return {
    problems,
    due: testing && latest && latest.due < today ? latest.due : undefined,
    noLine: testing && !latest,
  };
};

// その PR の会計区分の案(docs/guides/bets-and-assets.md の「案の表」)
export const proposalOf = (stage, kind) => {
  if (kind === "保守" || kind === "探索") return "費用";
  if (kind === "撤去") return "除却の候補(資産に載せた物があれば)";
  if (stage === undefined) return "人が決める(賭けの外の作り込み)";
  return stage === "rollout" || stage === "adopted" ? "資産の候補" : "費用";
};

// PR の本文の「- 取り組み: …」「- 作業の種類: …」の値(バッククォートは外す)
const fieldOf = (lines, key) => {
  const line = lines.find((l) => l.startsWith(`- ${key}:`));
  return (line?.slice(key.length + 3) ?? "").replaceAll("`", "").trim();
};

// 値の頭の言葉だけを見る(「保守(依存の更新)」「bet:B-0001 タスクのメール」も通す)
const checkWork = (work, kind, bets) => {
  const problems = [];
  const betId = work.startsWith("bet:") ? work.slice(4).trim().slice(0, 6) : undefined;
  if (!work) problems.push(`「- 取り組み:」が空。bet:B-NNNN / ${WORKS.join(" / ")} のどれか`);
  else if (betId === undefined && !WORKS.some((w) => work.startsWith(w)))
    problems.push(`取り組み「${work}」は bet:B-NNNN / ${WORKS.join(" / ")} のどれか`);
  else if (betId !== undefined && !Object.hasOwn(bets, betId))
    problems.push(`賭け ${betId} のファイルが docs/product/bets/ に無い(先に /bet で開く)`);
  const kindHead = KINDS.find((k) => kind.startsWith(k));
  if (!kindHead)
    problems.push(`作業の種類「${kind}」は ${KINDS.join(" / ")} のどれか(空ならここを埋める)`);
  return { problems, betId, kindHead };
};

// PR の本文を確かめる。author がボット(…[bot])で2つとも空なら「保守 / 保守」とみなす
export const checkPrBody = (body, { author = "", bets = {} } = {}) => {
  const lines = stripComments(body ?? "")
    .split("\n")
    .map((l) => l.trim());
  let work = fieldOf(lines, "取り組み");
  let kind = fieldOf(lines, "作業の種類");
  const notes = [];
  if (author.endsWith("[bot]") && !work && !kind) {
    work = "保守";
    kind = "保守";
    notes.push(`${author} の PR なので、取り組み・作業の種類を「保守」とみなしました`);
  }
  const checked = checkWork(work, kind, bets);
  const { problems, betId } = checked;
  if (problems.length > 0) return { problems, notes };
  kind = checked.kindHead;
  const stage = betId ? bets[betId] : undefined;
  if ((stage === "dropped" || stage === "retired") && kind !== "撤去")
    problems.push(`賭け ${betId} は ${stage}(終わった賭け)。この賭けでできるのは「撤去」だけ`);
  if (["idea", "cpf", "psf"].includes(stage) && kind === "作り込み")
    notes.push(
      `賭け ${betId} は ${stage}。この段階の作り込みは費用の案(合格の線を通ってから作り込みへ)`,
    );
  return { problems, notes, work, kind, stage, proposal: proposalOf(stage, kind) };
};
