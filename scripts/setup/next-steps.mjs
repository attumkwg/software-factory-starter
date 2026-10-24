// 人がやること(使う側のリポジトリで、済んでいない物だけ)。手元のファイルを読んで見分ける。書かない。
// 決まり: docs/designs/0014-setup-before-use.md の 6.「人がやること」
import { parse } from "yaml";
import { templateOwner } from "./config.mjs";
import { todo } from "./entries.mjs";

/**
 * src … { read(path) → 中身 | undefined }(手元のリポジトリ)
 * me  … 打った人({ login })。分からなければ undefined
 */
export function nextSteps({ setup, role, src, me }) {
  if (role !== "product")
    return [todo("Renovate の GitHub App が入っているか(README の「本人が手でやる設定」)")];
  const owner = templateOwner(setup);
  const by = me ? `@${me.login}` : "@<自分>";
  const steps = [todo("Renovate の GitHub App を入れる(README の「本人が手でやる設定」)")];
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
  if (ledgerText) {
    const ledger = parse(ledgerText) ?? {};
    const responder = String(ledger.owners?.responder ?? "").toLowerCase();
    if (responder === owner.toLowerCase())
      steps.push(todo(`点検の台帳を自分の物にする: pnpm checkup:adopt --by ${by}`));
    if (!ledger.refreshed_on)
      steps.push(
        todo(
          "最初の /checkup-refresh を流す(台帳を自分の物にした後。毎週の点検が「一度も流していない」と知らせる)",
        ),
      );
  }
  steps.push(
    todo(
      "ファイルを直したら1つの PR にする。設定ファイル(.github/setup.yml)を直したら、マージの後に pnpm setup:github --apply",
    ),
  );
  return steps;
}
