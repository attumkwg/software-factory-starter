import { describe, expect, it } from "vitest";
import { RETENTION_SMALL_BELOW, retention, type TenantWeeks } from "../../src/usage/index.ts";

// 継続率の計算(docs/designs/0022-usage-retention.md の 6)。DB を使わない。
// 週は月曜の日付。W0 から順に1週ずつ。数え終わった最後の週は W3(今週 W4 は途中)。

const [W0, W1, W2, W3, W4] = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
const BEFORE = "2026-09-21";
const range = { from: W0, lastFull: W3 };

describe("継続率", () => {
  it("組織は初めて使った週でまとめ、N 週後に使った数(active)と毎週続けた数(continued)を出す", () => {
    const a: TenantWeeks = [
      [W0, W1],
      [W2, W3],
    ]; // 組織としては W0〜W3 の毎週
    const b: TenantWeeks = [[W0, W2]]; // W1 は休んだ
    const c: TenantWeeks = [[W1]]; // W1 に始めて、それきり
    const { tenants } = retention([a, b, c], range);
    expect(tenants.cohorts).toEqual([
      {
        start: W0,
        size: 2,
        small: true,
        after: [
          { after: 1, active: 1, activePct: 50, continued: 1, continuedPct: 50 },
          { after: 2, active: 2, activePct: 100, continued: 1, continuedPct: 50 },
          { after: 3, active: 1, activePct: 50, continued: 1, continuedPct: 50 },
        ],
      },
      {
        start: W1,
        size: 1,
        small: true,
        after: [
          { after: 1, active: 0, activePct: 0, continued: 0, continuedPct: 0 },
          { after: 2, active: 0, activePct: 0, continued: 0, continuedPct: 0 },
        ],
      },
    ]);
    // 足し合わせは、N 週後まで届いた組だけ(3週後は W0 の組だけ)
    expect(tenants.overall).toEqual([
      { after: 1, size: 3, small: true, active: 1, activePct: 33, continued: 1, continuedPct: 33 },
      { after: 2, size: 3, small: true, active: 2, activePct: 67, continued: 1, continuedPct: 33 },
      { after: 3, size: 2, small: true, active: 1, activePct: 50, continued: 1, continuedPct: 50 },
    ]);
  });

  it("人は人ごとに初めて使った週でまとめる(組織の組とは別)", () => {
    const a: TenantWeeks = [
      [W0, W1],
      [W2, W3],
    ];
    const { users } = retention([a], range);
    expect(users.cohorts.map((c) => [c.start, c.size, c.after.map((x) => x.active)])).toEqual([
      [W0, 1, [1, 0, 0]],
      [W2, 1, [1]],
    ]);
  });

  it("from より前に始めた物は数えない。今週に始めた組は大きさだけ(N 週後はまだ無い)", () => {
    const old: TenantWeeks = [[BEFORE, W1, W2]];
    const fresh: TenantWeeks = [[W4]];
    const { tenants, users } = retention([old, fresh], range);
    expect(tenants.cohorts).toEqual([{ start: W4, size: 1, small: true, after: [] }]);
    expect(tenants.overall).toEqual([]);
    expect(users.cohorts.map((c) => c.start)).toEqual([W4]);
  });

  it(`大きさが ${RETENTION_SMALL_BELOW} 以上の組は small ではない。足し合わせが届けば small ではない`, () => {
    const many: TenantWeeks[] = Array.from({ length: RETENTION_SMALL_BELOW }, (_, i) => [
      i === 0 ? [W0] : [W0, W1],
    ]);
    const { tenants } = retention(many, range);
    expect(tenants.cohorts[0]).toMatchObject({ size: RETENTION_SMALL_BELOW, small: false });
    expect(tenants.overall[0]).toMatchObject({ after: 1, small: false, active: 4, activePct: 80 });
  });

  it("使っていない組織(記録が無い)はどの組にも入らない。出す物に週と数のほかは無い", () => {
    const result = retention([[], [[W0, W1]]], range);
    expect(result.tenants.cohorts.map((c) => c.size)).toEqual([1]);
    expect(Object.keys(result.tenants.cohorts[0] ?? {}).sort()).toEqual([
      "after",
      "size",
      "small",
      "start",
    ]);
  });
});
