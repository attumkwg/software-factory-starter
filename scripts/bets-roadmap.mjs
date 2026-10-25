// 賭け(docs/product/bets/)からロードマップの1枚を作る。入口は bets.mjs の --roadmap。
// 社内の版は段階・親・次に決める日まで。社外の版は約束しない書き方(段階の言い換えと題名だけ)。
// 考え方は docs/guides/bets-and-assets.md の「ロードマップの1枚」。

const NOW = ["cpf", "psf", "rollout"];
const PUBLIC_WORDS = {
  cpf: "お客さんにお話を聞いています",
  psf: "試作で確かめています",
  rollout: "一部のお客さんに出しています",
};

// 題名から「賭け: B-NNNN」を外す
const nameOf = (r) => r.bet.title.slice(`賭け: ${r.id}`.length).trim();
const cell = (s) => (s ?? "—").replaceAll("|", "/");
const latestDue = (r) =>
  (r.bet.lines?.rows ?? [])
    .map(({ cells }) => ({ stage: cells[0], due: cells[4] }))
    .filter((l) => l.stage === r.bet.stage)
    .at(-1)?.due;

const table = (head, rows) => {
  if (rows.length === 0) return ["- なし"];
  const sep = `|${head.map(() => "---").join("|")}|`;
  return [`| ${head.join(" | ")} |`, sep, ...rows.map((c) => `| ${c.join(" | ")} |`)];
};

const nowRow = (r, today) => {
  const due = latestDue(r);
  const late = due && due < today ? " ⏰" : "";
  const will = r.wills > 0 ? " ⚑" : "";
  return [
    r.id,
    r.bet.stage + will,
    cell(nameOf(r)),
    cell(r.bet.parent),
    (due ?? "線がまだ無い") + late,
  ];
};

/** 社内の版(Markdown の行の配列) */
export function renderInternal(rows, today) {
  const by = (stages) => rows.filter((r) => stages.includes(r.bet.stage));
  return [
    "# ロードマップ(社内)",
    "",
    `> \`pnpm bets --roadmap --write\` が賭け(docs/product/bets/)から作る。手で直さない。作った日: ${today}`,
    "> ⚑ は線に届かなくても本人の意思で進んだ賭け。⏰ は次に決める日を過ぎた賭け。",
    "",
    "## いま確かめている",
    "",
    ...table(
      ["賭け", "段階", "何を", "親", "次に決める日"],
      by(NOW).map((r) => nowRow(r, today)),
    ),
    "",
    "## 次にやる",
    "",
    ...table(
      ["賭け", "何を", "親"],
      by(["idea"]).map((r) => [r.id, cell(nameOf(r)), cell(r.bet.parent)]),
    ),
    "",
    "## 定着した",
    "",
    ...table(
      ["賭け", "何を"],
      by(["adopted"]).map((r) => [r.id, cell(nameOf(r))]),
    ),
    "",
    "## やめた・撤去した",
    "",
    ...table(
      ["賭け", "段階", "何を"],
      by(["dropped", "retired"]).map((r) => [r.id, r.bet.stage, cell(nameOf(r))]),
    ),
    "",
  ];
}

const bullets = (rows, word) => {
  if (rows.length === 0) return ["- なし"];
  return rows.map((r) => `- ${cell(nameOf(r))}${word ? `(${word(r)})` : ""}`);
};

/** 社外の版(約束しない書き方。段階の言い換えと題名だけ。親・日付・ID は出さない) */
export function renderPublic(rows, today) {
  const by = (stages) => rows.filter((r) => stages.includes(r.bet.stage));
  return [
    "# これからの予定",
    "",
    `> 時期はお約束しません。お客さんと確かめながら作るので、変わったり、やめたりすることがあります(${today} 時点)。`,
    "",
    "## いま試していること",
    "",
    ...bullets(by(NOW), (r) => PUBLIC_WORDS[r.bet.stage]),
    "",
    "## これから試すこと",
    "",
    ...bullets(by(["idea"])),
    "",
    "## 使えるようになったこと",
    "",
    ...bullets(by(["adopted"])),
    "",
  ];
}
