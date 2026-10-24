// ラベルの手引き(docs/guides/labels.md)を、ラベルの一覧(.github/labels.yml)から作る。手で直さない。
//   pnpm setup:labels  … 作り直す / pnpm setup:check … 古ければ落ちる
// 決まり: docs/designs/0014-setup-before-use.md の 2.
export const LABELS_GUIDE = "docs/guides/labels.md";
export const GUIDE_FIELDS = ["group", "meaning", "who", "when", "action"];

const cell = (s) => String(s ?? "").replaceAll("|", "\\|");
const byPerson = (l) => String(l.who).startsWith("人");

function groups(labels) {
  const out = new Map();
  for (const l of labels) out.set(l.group, [...(out.get(l.group) ?? []), l]);
  return out;
}

/** 手引きの Markdown */
export function renderLabelsGuide(labels) {
  const handPicked = labels.filter(byPerson).map((l) => `\`${l.name}\``);
  const lines = [
    "# ラベルの手引き(何のラベルか・誰が付けるか・付いたらどうするか)",
    "",
    "> この1枚は [.github/labels.yml](../../.github/labels.yml)(ラベルの一覧。ここが正)から `pnpm setup:labels` で作る。手で直さない。",
    "> ラベルは `pnpm setup:github --apply` が GitHub に作る([github-setup.md](github-setup.md))。GitHub の画面のラベルの説明は、下の表の短い版。",
    "",
    "## まず覚えること",
    "",
    "- **ほとんどのラベルは自動で付く。** PR の危険度と場所は変えたファイルで(labeler)、Issue の種類はテンプレートで、依存の更新は Renovate が、点検の知らせは checkup.yml が付ける。",
    `- **人が手で付けるのは ${handPicked.join("・")} だけ。** ほかに、仕分けた Issue から \`needs-triage\` を外す。`,
    "- いちばん大事なのは **`risk:high`**(危険度「高」)。付いた PR は、マージの前に人が中身を読む。",
    "- 一覧に無いラベル(GitHub の既定の `bug` など)は使わなくてよい(消してもかまわないが、セットアップは消さない)。",
    "",
  ];
  for (const [group, items] of groups(labels)) {
    lines.push(
      `## ${group}`,
      "",
      "| ラベル | 何のラベルか | 誰が付けるか | いつ付く | 付いたら何をするか |",
      "|---|---|---|---|---|",
    );
    for (const l of items)
      lines.push(
        `| \`${l.name}\` | ${cell(l.meaning)} | ${cell(l.who)} | ${cell(l.when)} | ${cell(l.action)} |`,
      );
    lines.push("");
  }
  lines.push(
    "## ラベルを足す・変えるとき",
    "",
    "1. `.github/labels.yml` に1件足す(名前・色・短い説明・何のラベルか・誰が・いつ・付いたらどうするか・使っている所)。",
    "2. `pnpm setup:labels` でこの1枚を作り直す。`pnpm setup:check` が、コードが使うラベルが一覧にあるか・この1枚が古くないかを見る(CI でも)。",
    "3. PR をマージしたら、`pnpm setup:github --apply` で GitHub にも作る。",
    "",
  );
  return lines.join("\n");
}
