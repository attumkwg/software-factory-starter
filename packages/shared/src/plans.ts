import { z } from "zod";
import { DateOnlySchema } from "./time.ts";

// 契約のプランと価格表の定義(docs/specs/0047-plans.md・ADR 0058)。
// 組織ごとの「どのプランを・どの価格表で・何人まで・据え置きはいつまで」は DB(platform.tenant_plans)。
// 変えるのは運営のコマンド plan だけ(docs/runbooks/plans.md)。**プラン・価格表を足す・変えるのは PR で**。
//
// 金額は持たない(請求は外の会計ソフトで手で。キットはお金を受け取らない)。価格表は「版の名前と、いつからか」だけで、
// 金額は申込書と会計ソフトにある。組織が「どの版の価格表で契約しているか」を持つのが、値上げの据え置きのため。
//
// 決まり(plans.test.ts が確かめる):
// - プランの名前・価格表の名前は英小文字・数字・「-」(先頭は英字か数字・32文字まで)。重ならない。**一度使った名前は使い回さない**
// - プランの機能は FEATURE_FLAGS の名前で、状態が plan の物(プランで出し分ける機能)

/**
 * 人数の上限を超えたときの扱い。
 * block … 上限(いる人+受けていない招待)に届いたら、それ以上は招けない(409 seat_limit_reached)
 * count … 止めない(運営のコマンド plan-report が超えた組織を出す。翌月から請求する・話し合う、は人が決める)
 */
export const SEAT_POLICIES = ["block", "count"] as const;
export type SeatPolicy = (typeof SEAT_POLICIES)[number];

export type PlanDefinition = {
  /** コマンド・DB・API で使う名前 */
  id: string;
  /** 画面に出す名前 */
  label: string;
  /** このプランで入る機能(FEATURE_FLAGS の名前で、状態が plan の物) */
  features: readonly string[];
  seatPolicy: SeatPolicy;
};

export type PriceListDefinition = {
  /** 版の名前(例 "2026-10")。申込書と会計ソフトの価格表と同じ名前にする */
  id: string;
  /** この日から新しく契約する組織に使う(YYYY-MM-DD) */
  effectiveFrom: string;
  /** 何が変わった版か(一言。金額は書かない) */
  description: string;
};

/**
 * プランの一覧。キットの既定は1つ(機能の出し分けは無い)。足すときは、たとえば:
 *   { id: "pro", label: "プロ", features: ["morning-digest"], seatPolicy: "block" },
 */
export const PLANS = [
  { id: "standard", label: "スタンダード", features: [], seatPolicy: "block" },
] as const satisfies readonly PlanDefinition[];

export type PlanId = (typeof PLANS)[number]["id"];

/**
 * 価格表の版の一覧(古い順)。値上げ・値下げのときは、新しい版を**足す**(古い版は消さない。据え置きの組織が使っている)。
 */
export const PRICE_LISTS = [
  { id: "2026-10", effectiveFrom: "2026-10-01", description: "最初の価格表" },
] as const satisfies readonly PriceListDefinition[];

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** 定義の書き方の誤り(無ければ空)。planFeatureNames … 状態が plan の機能の名前 */
export function planProblems(
  plans: readonly PlanDefinition[],
  priceLists: readonly PriceListDefinition[],
  planFeatureNames: readonly string[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of plans) {
    if (!NAME.test(p.id)) problems.push(`${p.id}: プランの名前は英小文字・数字・「-」`);
    if (seen.has(p.id)) problems.push(`${p.id}: プランの名前が重なっている`);
    seen.add(p.id);
    if (p.label.trim() === "") problems.push(`${p.id}: 画面に出す名前が空`);
    for (const f of p.features.filter((f) => !planFeatureNames.includes(f))) {
      problems.push(`${p.id}: ${f} は FEATURE_FLAGS に無いか、状態が plan ではない`);
    }
  }
  return [...problems, ...priceListProblems(priceLists)];
}

function priceListProblems(priceLists: readonly PriceListDefinition[]): string[] {
  const problems: string[] = [];
  const lists = new Set<string>();
  let last = "";
  for (const l of priceLists) {
    if (!NAME.test(l.id)) problems.push(`${l.id}: 価格表の名前は英小文字・数字・「-」`);
    if (lists.has(l.id)) problems.push(`${l.id}: 価格表の名前が重なっている`);
    lists.add(l.id);
    if (!DateOnlySchema.safeParse(l.effectiveFrom).success) {
      problems.push(`${l.id}: effectiveFrom は YYYY-MM-DD`);
    }
    if (l.effectiveFrom <= last) problems.push(`${l.id}: 価格表は古い順に、日付を重ねずに並べる`);
    last = l.effectiveFrom;
  }
  if (priceLists.length === 0) problems.push("価格表が1つも無い");
  return problems;
}

/** その日(YYYY-MM-DD)に新しく契約する組織に使う価格表。まだ始まっていなければ undefined */
export function currentPriceList(
  priceLists: readonly PriceListDefinition[],
  today: string,
): PriceListDefinition | undefined {
  return priceLists.filter((l) => l.effectiveFrom <= today).at(-1);
}

// ── 組織のプラン(GET /api/organization/plan。管理者だけ) ──────────────────────────

export const OrganizationPlanSchema = z.object({
  /** いまのプラン。まだ決まっていない(運営が入れていない)組織は null */
  plan: z
    .object({
      id: z.string(),
      label: z.string(),
      priceList: z.string(),
      /** 人数の上限。null は上限なし */
      seats: z.number().int().positive().nullable(),
      seatPolicy: z.enum(SEAT_POLICIES),
      /** 据え置き(旧価格のまま)の期限。null は据え置きなし */
      priceLockedUntil: DateOnlySchema.nullable(),
      /** この契約がいつからか */
      effectiveOn: DateOnlySchema,
    })
    .nullable(),
  /** いる人の数 */
  members: z.number().int().nonnegative(),
  /** 受けていない(期限内の)招待の数。人数の上限は「いる人+受けていない招待」で数える */
  pendingInvitations: z.number().int().nonnegative(),
});
export type OrganizationPlan = z.infer<typeof OrganizationPlanSchema>;
