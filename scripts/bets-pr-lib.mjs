// PR の本文の「取り組み」「作業の種類」を確かめる中身(bets-lib.mjs から出し直す)。決まりは docs/guides/bets-and-assets.md。
import { stripComments } from "./bets-lib.mjs";

export const WORKS = ["保守", "不具合", "基盤", "セキュリティ"];
export const KINDS = ["探索", "作り込み", "保守", "撤去"];

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
