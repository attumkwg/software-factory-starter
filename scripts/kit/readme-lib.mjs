// README の「使い始めたらやること」の節を、カタログから作る。印の間だけを書き換える(ほかは手で書いた物)。
export const START = "<!-- kit:readme:start -->";
export const END = "<!-- kit:readme:end -->";
const NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

const statusLabel = (x) => (x.pr ? `${x.status}(PR #${x.pr})` : x.status);
const code = (s) => (s ? `\`${s}\`` : "—");

function stepRows(steps) {
  return steps.map((s, i) => {
    const how = s.command ? `${code(s.command)}: ${s.does}` : s.does;
    const link = s.link ? `[手順](${s.link})` : "";
    const out = [s.writes ? code(s.writes) : "", link].filter(Boolean).join("・") || "—";
    return `| ${NUMBERS[i] ?? i + 1} | ${s.title} | ${how} | ${out} | ${s.status} |`;
  });
}

function partRows(catalog) {
  const rows = [];
  for (const g of catalog.groups) {
    for (const p of catalog.parts.filter((x) => x.group === g.id)) {
      const name = p.removable === false ? `🔒 ${p.name}` : p.name;
      rows.push(
        `| ${g.name} | ${name} \`${p.id}\` | ${p.what} | ${p.default} | ${statusLabel(p)} |`,
      );
    }
  }
  return rows;
}

/** 印の間に入れる中身(印は含まない) */
export function renderSection(catalog) {
  const questions = catalog.questions.map((q) => q.text).join("/");
  return [
    "## 🧰 使い始めたらやること",
    "",
    "> この節は [docs/kit/catalog.yaml](docs/kit/catalog.yaml)(部品のカタログ)から `pnpm kit:readme` で作る。手で直さない。",
    "",
    "| # | やること | どうやって | 残る物 | 状態 |",
    "|---|---|---|---|---|",
    ...stepRows(catalog.start_steps),
    "",
    "### 部品の一覧(`/tailor` で残す・消すを決める)",
    "",
    `\`/tailor\` が聞くこと: ${questions}。`,
    "",
    "- 🔒 は土台。どの答えでも消さない。",
    "- 既定は、迷ったときのおすすめ。**迷ったら残す**(消すのは後からでもできる。足し直すほうが高い)。",
    "- 消す部品は1つずつ PR で(消し方はカタログの `remove`)。決めたことは `docs/product/tailoring.md` に残す。",
    "",
    "| 区分 | 部品 | 何をするか | 既定 | 状態 |",
    "|---|---|---|---|---|",
    ...partRows(catalog),
  ].join("\n");
}

/** README の印の間を作り直した全文。印が無ければ投げる */
export function replaceSection(readme, section) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error(`README に ${START} と ${END} の印がありません`);
  return `${readme.slice(0, start + START.length)}\n${section}\n${readme.slice(end)}`;
}
