// 人がやること(使う側のリポジトリで、済んでいない物だけ)。手元のファイルを読んで見分ける。書かない。
// キットの古くなった所(作った後のキットの更新・台帳の取り込みの古さ・見直す日の来た項目)も、作り始めるこのときに知らせる
// (キットそのものは定期の運用を回さないので、溜まった分はここで出る。ADR 0027)。
// 決まり: docs/designs/0014-setup-before-use.md の 6.「人がやること」
import { parse } from "yaml";
import { todayInTokyo } from "../checkup/phase.mjs";
import { REFRESH_DAYS, refreshDue, reviewDue } from "../checkup/todo.mjs";
import { templateOwner } from "./config.mjs";
import { todo } from "./entries.mjs";

const day = (iso) => String(iso ?? "").slice(0, 10);

/** キットの古くなった所(使う側で、作り始めるときだけ) */
function kitFreshness({ setup, ledger, kit, today }) {
  const steps = [];
  if (kit?.updatedAt && kit?.createdAt && day(kit.updatedAt) > day(kit.createdAt))
    steps.push(
      todo(
        `このリポジトリを作った後(${day(kit.createdAt)})にキットが更新されている(最後 ${day(kit.updatedAt)})。取り込みたい直しが無いか https://github.com/${setup.template_repository}/commits を見る`,
      ),
    );
  if (!ledger) return steps;
  const refresh = refreshDue(ledger, today);
  if (refresh.due)
    steps.push(
      todo(
        `最初の /checkup-refresh を流す(キットの台帳が世の中の変化を取り込んだのは${refresh.days === undefined ? "一度も無い" : ` ${refresh.days}日前(${REFRESH_DAYS}日を過ぎた)`}。台帳を自分の物にした後に)`,
      ),
    );
  const due = reviewDue(ledger, today);
  if (due.length > 0)
    steps.push(
      todo(
        `キットの台帳で見直す日の過ぎた項目 ${due.length}件(${due.map((i) => i.id).join("・")})。/checkup-refresh で見直す`,
      ),
    );
  return steps;
}

/**
 * src … { read(path) → 中身 | undefined }(手元のリポジトリ)
 * me  … 打った人({ login })。分からなければ undefined
 * kit … { createdAt: このリポジトリを作った日, updatedAt: キットの最後のコミットの日 }(分からなければ undefined)
 */
export function nextSteps({ setup, role, src, me, kit, today = todayInTokyo() }) {
  if (role !== "product")
    return [todo("Renovate の GitHub App が入っているか(README の「本人が手でやる設定」)")];
  const owner = templateOwner(setup);
  const by = me ? `@${me.login}` : "@<自分>";
  const steps = [
    todo(
      "Renovate の GitHub App を入れる(README の「本人が手でやる設定」)。入れると、キットに溜まった依存の更新が PR で出る(最初の週は多め)",
    ),
  ];
  if (!src.read("docs/product/plan.md"))
    steps.push(todo("/kickoff で、何を・誰のために作るかを決める"));
  if (!src.read("docs/product/tailoring.md"))
    steps.push(
      todo("/tailor で部品を選ぶ(キットが既定で決めた所 = pnpm decisions --adopt もここで)"),
    );
  const codeowners = src.read(".github/CODEOWNERS") ?? "";
  if (codeowners.split(/\s+/).includes(owner))
    steps.push(todo(`.github/CODEOWNERS の ${owner}(キットの持ち主)を、自分かチームにする`));
  const ledgerText = src.read("docs/checkup/todo.yaml");
  const ledger = ledgerText ? (parse(ledgerText) ?? {}) : undefined;
  if (String(ledger?.owners?.responder ?? "").toLowerCase() === owner.toLowerCase())
    steps.push(todo(`点検の台帳を自分の物にする: pnpm checkup:adopt --by ${by}`));
  steps.push(...kitFreshness({ setup, ledger, kit, today }));
  steps.push(
    todo(
      "ファイルを直したら1つの PR にする。設定ファイル(.github/setup.yml)を直したら、マージの後に pnpm setup:github --apply",
    ),
  );
  return steps;
}
