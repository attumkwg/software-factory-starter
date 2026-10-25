import { describe, expect, it } from "vitest";
import { enabledFeatures, FEATURE_FLAGS, type FeatureFlagDefinition } from "./feature-flags.ts";
import {
  currentPriceList,
  PLANS,
  type PlanDefinition,
  PRICE_LISTS,
  type PriceListDefinition,
  planProblems,
} from "./plans.ts";

// プランと価格表の定義(docs/specs/0047-plans.md)。

const planFeatureNames = (FEATURE_FLAGS as readonly FeatureFlagDefinition[])
  .filter((d) => d.state === "plan")
  .map((d) => d.name);

const plan = (over: Partial<PlanDefinition> & Pick<PlanDefinition, "id">): PlanDefinition => ({
  label: "名前",
  features: [],
  ...over,
});
const list = (id: string, effectiveFrom: string): PriceListDefinition => ({
  id,
  effectiveFrom,
  description: "説明",
});

describe("プランと価格表の定義", () => {
  it("キットの一覧は書き方の決まりを守る", () => {
    expect(planProblems(PLANS, PRICE_LISTS, planFeatureNames)).toEqual([]);
  });

  it("名前の形・重なり・空の名前・plan ではない機能・価格表の並びを見つける", () => {
    const problems = planProblems(
      [
        plan({ id: "pro", features: ["picked", "unknown"] }),
        plan({ id: "pro" }),
        plan({ id: "Bad_Plan", label: " " }),
      ],
      [list("2027-01", "2027-01-01"), list("2026-10", "2026-10-01"), list("x", "2026/10/01")],
      ["picked"],
    );
    expect(problems).toEqual([
      "pro: unknown は FEATURE_FLAGS に無いか、状態が plan ではない",
      "pro: プランの名前が重なっている",
      "Bad_Plan: プランの名前は英小文字・数字・「-」",
      "Bad_Plan: 画面に出す名前が空",
      "2026-10: 価格表は古い順に、日付を重ねずに並べる",
      "x: effectiveFrom は YYYY-MM-DD",
    ]);
    expect(planProblems([], [], [])).toEqual(["価格表が1つも無い"]);
  });

  it("その日の価格表は、始まっている中で一番新しい版", () => {
    const lists = [list("2026-10", "2026-10-01"), list("2027-04", "2027-04-01")];
    expect(currentPriceList(lists, "2026-09-30")).toBeUndefined();
    expect(currentPriceList(lists, "2026-10-01")?.id).toBe("2026-10");
    expect(currentPriceList(lists, "2027-03-31")?.id).toBe("2026-10");
    expect(currentPriceList(lists, "2027-04-01")?.id).toBe("2027-04");
  });
});

describe("プランで入る機能(状態 plan)", () => {
  const defs: FeatureFlagDefinition[] = [
    { name: "pro-only", bet: "B-0001", description: "上のプランだけ", state: "plan" },
    { name: "picked", bet: "B-0001", description: "選んだ組織だけ", state: "rollout" },
  ];

  it("プランに入っていれば入る。プランの外でも、運営が組織に入れた行があれば入る(試しに出す)", () => {
    expect(enabledFeatures(defs, [], ["pro-only"])).toEqual(["pro-only"]);
    expect(enabledFeatures(defs, ["pro-only"], [])).toEqual(["pro-only"]);
    expect(enabledFeatures(defs, [], [])).toEqual([]);
  });

  it("rollout の機能は、プランに書いてあっても入らない(組織ごとの行だけ)", () => {
    expect(enabledFeatures(defs, [], ["picked"])).toEqual([]);
  });
});
