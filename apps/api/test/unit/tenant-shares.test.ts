import { describe, expect, it } from "vitest";
import { parseTenantSharesArgs, sharesOf } from "../../src/usage/index.ts";

// 1社あたりの原価の按分の元(docs/designs/0042-tenant-cost.md の 6)。DB を使わない。

describe("按分の元", () => {
  it("組織を人数の帯に分け、帯ごとの合計といちばん大きい組織の割合だけを出す", () => {
    const shares = sharesOf("2026-10", [
      { users: 3, rows: 100, writes: 10 },
      { users: 5, rows: 300, writes: 30 },
      { users: 12, rows: 600, writes: 60 },
    ]);
    expect(shares).toEqual({
      month: "2026-10",
      tenantsTotal: 3,
      smallBelow: 5,
      totals: { users: 20, rows: 1000, writes: 100 },
      bands: [
        { band: "1〜5人", tenants: 2, small: true, users: 8, rows: 400, writes: 40 },
        { band: "6〜20人", tenants: 1, small: true, users: 12, rows: 600, writes: 60 },
      ],
      largestPct: { users: 60, rows: 60, writes: 60 },
    });
  });

  it("帯の境い目(5人は小さい帯・101人から大きい帯)。組織の無い帯は出さない。0件でも止まらない", () => {
    const shares = sharesOf("2026-10", [
      ...Array.from({ length: 5 }, () => ({ users: 20, rows: 1, writes: 0 })),
      { users: 101, rows: 1, writes: 0 },
    ]);
    expect(shares.bands.map((b) => [b.band, b.tenants, b.small])).toEqual([
      ["6〜20人", 5, false],
      ["101人〜", 1, true],
    ]);
    expect(shares.largestPct.writes).toBe(0);
    expect(sharesOf("2026-10", [])).toMatchObject({ tenantsTotal: 0, bands: [] });
  });

  it("月は --month(YYYY-MM)。無ければ前の月", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    expect(parseTenantSharesArgs([], now)).toEqual({ month: "2025-12" });
    expect(parseTenantSharesArgs(["--month", "2026-10"], now)).toEqual({ month: "2026-10" });
    expect(() => parseTenantSharesArgs(["--month", "2026-13"], now)).toThrow("YYYY-MM");
  });
});
