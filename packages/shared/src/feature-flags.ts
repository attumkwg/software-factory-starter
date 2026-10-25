// 組織ごとの機能フラグの定義(docs/specs/0012-feature-flags-and-usage.md・ADR 0025)。
// 組織ごとの「入れた」は DB(platform.feature_flags)。切り替えるのは運営のコマンドだけ(docs/runbooks/feature-flags.md)。
// **足す・状態を変える・消すのは PR で**(手順は docs/guides/feature-flags.md)。画面と API が、この一覧を同じに見る。
//
// 決まり(feature-flags.test.ts と apps/api/test/unit/feature-flags.test.ts が確かめる):
// - 名前は英小文字・数字・「-」(先頭は英字・48文字まで)。重ならない。**一度使った名前は使い回さない**(古い行が生き返る)
// - bet は賭けのファイル(docs/product/bets/B-NNNN-*.md)。段階が psf / rollout / adopted のどれか
//   (dropped / retired になったら、フラグと呼び出しを消す PR を出す。残っていると CI が落ちる)

export const FEATURE_FLAG_STATES = ["rollout", "on", "off", "plan"] as const;
/**
 * rollout … 運営が入れた組織だけ(賭けの psf / rollout)
 * on      … 全部の組織(賭けの adopted。組織ごとの行は見ない)
 * plan    … いまのプランに入っている組織だけ(賭けの adopted で、上のプランにだけ出す。`PLANS` の features)。
 *           運営が組織ごとに入れた行も効く(プランの外の組織に試しに出す。docs/specs/0047-plans.md)
 * off     … 全部の組織で止める(壊れたとき。組織ごとの行は見ない。デプロイが要る)
 */
export type FeatureFlagState = (typeof FEATURE_FLAG_STATES)[number];

export type FeatureFlagDefinition = {
  /** 画面・API・コマンドで使う名前 */
  name: string;
  /** どの賭けの機能か(B-NNNN) */
  bet: string;
  /** 何を出し分けるか(一言) */
  description: string;
  state: FeatureFlagState;
};

/**
 * 機能フラグの一覧。いまは無い(キットは何も出し分けない)。足すときは、たとえば:
 *   { name: "morning-digest", bet: "B-0002", description: "期限が近いタスクを朝にまとめて知らせる", state: "rollout" },
 */
export const FEATURE_FLAGS = [] as const satisfies readonly FeatureFlagDefinition[];

/** 定義にある名前だけ(書き間違いは型の検査で落ちる)。一覧が空のうちは、どの名前も使えない */
export type FeatureFlagName = (typeof FEATURE_FLAGS)[number]["name"];

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const BET = /^B-\d{4}$/;

/** 定義の書き方の誤り(無ければ空) */
export function featureFlagProblems(defs: readonly FeatureFlagDefinition[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (!NAME.test(d.name)) problems.push(`${d.name}: 名前は英小文字・数字・「-」(先頭は英字)`);
    if (seen.has(d.name)) problems.push(`${d.name}: 名前が重なっている`);
    seen.add(d.name);
    if (!BET.test(d.bet)) problems.push(`${d.name}: bet は B-NNNN の形`);
    if (d.description.trim() === "") problems.push(`${d.name}: 説明が空`);
  }
  return problems;
}

/**
 * その組織で入っている機能の名前(定義の順)。
 * enabledInOrg … その組織に入れた名前(platform.feature_flags の行)。定義に無い名前は捨てる
 * planFeatures … その組織のいまのプランの機能(PLANS の features。プランが無ければ空)
 */
export function enabledFeatures(
  defs: readonly FeatureFlagDefinition[],
  enabledInOrg: Iterable<string>,
  planFeatures: Iterable<string> = [],
): string[] {
  const rows = new Set(enabledInOrg);
  const plan = new Set(planFeatures);
  return defs.filter((d) => isEnabled(d, rows, plan)).map((d) => d.name);
}

/** 1つの機能が、その組織で入っているか(enabledFeatures と、API の守り requireFeature で同じ判定) */
export function isEnabled(
  def: FeatureFlagDefinition,
  orgRows: ReadonlySet<string>,
  planFeatures: ReadonlySet<string>,
): boolean {
  switch (def.state) {
    case "on":
      return true;
    case "off":
      return false;
    case "rollout":
      return orgRows.has(def.name);
    case "plan":
      return planFeatures.has(def.name) || orgRows.has(def.name);
  }
}

/** 画面の出し分け(GET /api/me の features)。**守りは API 側**(requireFeature)。画面で隠すだけで安心しない */
export function hasFeature(me: { features?: readonly string[] }, name: FeatureFlagName): boolean {
  return me.features?.includes(name) ?? false;
}
