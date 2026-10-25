import { describe, expect, it } from "vitest";
import { type Defs, type PlanLine, planChange } from "../../src/plans/index.ts";

// プランを変えるときの決まり(docs/designs/0047-plans.md の 6)。DB に触らない。

const defs: Defs = {
  plans: [
    { id: "standard", label: "スタンダード", features: [] },
    { id: "pro", label: "プロ", features: [] },
  ],
  priceLists: [
    { id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" },
    { id: "2027-04", effectiveFrom: "2027-04-01", description: "値上げ" },
  ],
};

const locked: PlanLine = {
  plan: "standard",
  priceList: "2026-10",
  seats: 10,
  priceLockedUntil: "2028-03-31",
  effectiveOn: "2026-11-01",
};

describe("プランを変えるときの決まり", () => {
  it("初めてなら、その日の価格表・人数は上限なし・据え置きなし・今日から", () => {
    expect(planChange(null, { plan: "standard" }, defs, "2027-05-01")).toEqual({
      plan: "standard",
      priceList: "2027-04",
      seats: null,
      priceLockedUntil: null,
      effectiveOn: "2027-05-01",
    });
  });

  it("同じプランで人数だけ変えると、価格表と据え置きはそのまま(値上げの後でも旧価格)", () => {
    expect(planChange(locked, { plan: "standard", seats: 15 }, defs, "2027-05-01")).toEqual({
      ...locked,
      seats: 15,
      effectiveOn: "2027-05-01",
    });
  });

  it("プランを変えると、その日の価格表に移り、据え置きは消える。人数は省けばそのまま", () => {
    expect(planChange(locked, { plan: "pro" }, defs, "2027-05-01")).toEqual({
      plan: "pro",
      priceList: "2027-04",
      seats: 10,
      priceLockedUntil: null,
      effectiveOn: "2027-05-01",
    });
  });

  it("値上げのときに据え置きを付ける: 価格表を旧版のまま、期限を渡す", () => {
    expect(
      planChange(
        null,
        { plan: "standard", priceList: "2026-10", priceLockedUntil: "2028-03-31", seats: 10 },
        defs,
        "2027-05-01",
      ),
    ).toMatchObject({ priceList: "2026-10", priceLockedUntil: "2028-03-31" });
  });

  it("据え置きの期限が来たら、新しい価格表を渡して移す(据え置きは消える)", () => {
    expect(
      planChange(locked, { plan: "standard", priceList: "2027-04" }, defs, "2028-04-01"),
    ).toMatchObject({ priceList: "2027-04", priceLockedUntil: null, seats: 10 });
  });

  it("定義に無いプラン・価格表・形の違う日付・0人は止める", () => {
    expect(() => planChange(null, { plan: "gold" }, defs, "2027-05-01")).toThrow(/プラン/);
    expect(() =>
      planChange(null, { plan: "pro", priceList: "2099-01" }, defs, "2027-05-01"),
    ).toThrow(/価格表/);
    expect(() =>
      planChange(null, { plan: "pro", effectiveOn: "2027/05/01" }, defs, "2027-05-01"),
    ).toThrow(/effective-on/);
    expect(() => planChange(null, { plan: "pro", seats: 0 }, defs, "2027-05-01")).toThrow(/seats/);
    expect(() => planChange(null, { plan: "pro" }, defs, "2026-09-01")).toThrow(/価格表/);
  });
});
