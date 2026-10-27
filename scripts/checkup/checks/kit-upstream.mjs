// kit-upstream: キットの新しい版を取り込んだか(docs/kit/upstream.yaml の版と、キットの最新のリリース)。
// ひな形(キットのリポジトリ。ctx.role === "template")では比べない(取り込む側ではない)。
// キットにまだ版(リリース)が無い間は合格。決まり: docs/designs/0067-kit-upstream.md
import { unknownFrom } from "../gh.mjs";
import {
  compareUpstream,
  latestRelease,
  readUpstream,
  UPSTREAM_FILE,
  upstreamMessage,
} from "../upstream.mjs";

/** キットのリポジトリ: 記録の repository、無ければ .github/setup.yml の template_repository */
function kitRepository(ctx, upstream) {
  if (upstream?.repository) return upstream.repository;
  return String(ctx.read(".github/setup.yml") ?? "").match(/^template_repository:\s*(\S+)/m)?.[1];
}

export async function check(ctx) {
  if (ctx.role === "template")
    return { result: "pass", note: "キットそのもの(取り込む側ではない)" };
  const upstream = readUpstream(ctx.read(UPSTREAM_FILE));
  const repository = kitRepository(ctx, upstream);
  if (!repository)
    return { result: "unknown", note: `キットのリポジトリが分からない(${UPSTREAM_FILE})` };
  const latest = latestRelease(ctx.gh, repository);
  if (!latest.ok) return unknownFrom(latest, "キットのリリース");
  if (!latest.tag) return { result: "pass", note: "キットにまだ版(リリース)が無い" };
  const cmp = compareUpstream(upstream?.version, latest.tag);
  if (cmp.state === "unknown")
    return { result: "unknown", note: `キットの最新の版の形が違う(${latest.tag})` };
  if (cmp.state === "latest")
    return { result: "pass", note: `キットの最新の版 ${latest.tag} を取り込んでいる` };
  return {
    result: "fail",
    note: upstreamMessage({
      repository,
      current: upstream?.version,
      latest: latest.tag,
      hands: cmp.hands,
    }),
  };
}
