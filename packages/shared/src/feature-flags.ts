// 組織ごとの機能フラグの定義(docs/specs/0012-feature-flags-and-usage.md・ADR 0025)。
// 組織ごとの「入れた」は DB(platform.feature_flags)。切り替えるのは運営のコマンドだけ(docs/runbooks/feature-flags.md)。
// **足す・状態を変える・消すのは PR で**(手順は docs/guides/feature-flags.md)。画面と API が、この一覧を同じに見る。
//
// 決まり(feature-flags.test.ts と apps/api/test/unit/feature-flags.test.ts が確かめる):
// - 名前は英小文字・数字・「-」(先頭は英字・48文字まで)。重ならない。**一度使った名前は使い回さない**(古い行が生き返る)
// - bet は賭けのファイル(docs/product/bets/B-NNNN-*.md)。段階が psf / rollout / adopted のどれか
//   (dropped / retired になったら、フラグと呼び出しを消す PR を出す。残っていると CI が落ちる)
// - キットの仕組み(賭けではなく、プロダクト全体を測る物。例: PMF の兆しを聞く)は bet を "kit" にする。
//   賭けの段階には縛られない(消すのはキットの部品を消すとき。docs/kit/catalog.yaml)

export const FEATURE_FLAG_STATES = ["rollout", "on", "off"] as const;
/**
 * rollout … 運営が入れた組織だけ(賭けの psf / rollout)
 * on      … 全部の組織(賭けの adopted。組織ごとの行は見ない)
 * off     … 全部の組織で止める(壊れたとき。組織ごとの行は見ない。デプロイが要る)
 */
export type FeatureFlagState = (typeof FEATURE_FLAG_STATES)[number];

export type FeatureFlagDefinition = {
  /** 画面・API・コマンドで使う名前 */
  name: string;
  /** どの賭けの機能か(B-NNNN)。キットの仕組みなら "kit" */
  bet: string;
  /** 何を出し分けるか(一言) */
  description: string;
  state: FeatureFlagState;
};

/**
 * 機能フラグの一覧。賭けの機能を足すときは、たとえば:
 *   { name: "morning-digest", bet: "B-0002", description: "期限が近いタスクを朝にまとめて知らせる", state: "rollout" },
 */
export const FEATURE_FLAGS = [
  // キットの仕組み: 「無くなったら困るか」を画面の中で聞く(docs/specs/0046-pmf-survey.md)。運営が入れた組織の人にだけ聞く
  {
    name: "pmf-survey",
    bet: "kit",
    description: "「このサービスが使えなくなったら、どう感じますか」を画面の中で聞く(PMF の兆し)",
    state: "rollout",
  },
] as const satisfies readonly FeatureFlagDefinition[];

/** 定義にある名前だけ(書き間違いは型の検査で落ちる)。一覧が空のうちは、どの名前も使えない */
export type FeatureFlagName = (typeof FEATURE_FLAGS)[number]["name"];

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const BET = /^(B-\d{4}|kit)$/;

/** 定義の書き方の誤り(無ければ空) */
export function featureFlagProblems(defs: readonly FeatureFlagDefinition[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (!NAME.test(d.name)) problems.push(`${d.name}: 名前は英小文字・数字・「-」(先頭は英字)`);
    if (seen.has(d.name)) problems.push(`${d.name}: 名前が重なっている`);
    seen.add(d.name);
    if (!BET.test(d.bet)) problems.push(`${d.name}: bet は B-NNNN の形(キットの仕組みは kit)`);
    if (d.description.trim() === "") problems.push(`${d.name}: 説明が空`);
  }
  return problems;
}

/**
 * その組織で入っている機能の名前(定義の順)。
 * enabledInOrg … その組織に入れた名前(platform.feature_flags の行)。定義に無い名前は捨てる
 */
export function enabledFeatures(
  defs: readonly FeatureFlagDefinition[],
  enabledInOrg: Iterable<string>,
): string[] {
  const rows = new Set(enabledInOrg);
  return defs
    .filter((d) => d.state === "on" || (d.state === "rollout" && rows.has(d.name)))
    .map((d) => d.name);
}

/** 画面の出し分け(GET /api/me の features)。**守りは API 側**(requireFeature)。画面で隠すだけで安心しない */
export function hasFeature(me: { features?: readonly string[] }, name: FeatureFlagName): boolean {
  return me.features?.includes(name) ?? false;
}
