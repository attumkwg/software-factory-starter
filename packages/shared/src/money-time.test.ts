import { describe, expect, it } from "vitest";
import {
  allocate,
  formatMoney,
  money,
  multiply,
  parseMajor,
  sum,
  taxByRate,
  toMajorString,
} from "./money.ts";
import {
  DateOnlySchema,
  InstantSchema,
  isValidTimeZone,
  localDayRange,
  toLocalDate,
} from "./time.ts";

describe("お金", () => {
  it("小数(float)で計算すると崩れる例を、整数で正しく扱える", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sum([money(10, "USD"), money(20, "USD")], "USD")).toEqual(money(30, "USD"));
  });

  it("掛け算は1回だけ、指定した丸め方で丸める", () => {
    // 1,234円 × 10% = 123.4円
    expect(multiply(money(1234, "JPY"), "0.1", "floor").amount).toBe(123);
    expect(multiply(money(1234, "JPY"), "0.1", "ceil").amount).toBe(124);
    // 0.5 ちょうど: 四捨五入は上へ、銀行丸めは偶数へ
    expect(multiply(money(125, "JPY"), "0.1", "half_up").amount).toBe(13);
    expect(multiply(money(125, "JPY"), "0.1", "half_even").amount).toBe(12);
    // 返金(マイナス)でも、切り捨ては「小さい方へ」
    expect(multiply(money(-1234, "JPY"), "0.1", "floor").amount).toBe(-124);
  });

  it("インボイス: 明細ごとに丸めると1円ずれる。税率ごとに合計してから1回丸める", () => {
    const lines = [105, 105, 105].map((a) => ({ amount: money(a, "JPY"), rate: "0.1" }));
    const perLine = lines.reduce((s, l) => s + multiply(l.amount, l.rate, "floor").amount, 0); // 10+10+10
    const [byRate] = taxByRate(lines, "JPY", "floor"); // 315 × 10% = 31.5 → 31
    expect(perLine).toBe(30);
    expect(byRate?.tax.amount).toBe(31);
  });

  it("按分しても合計は元のまま", () => {
    const parts = allocate(money(100, "JPY"), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(sum(parts, "JPY").amount).toBe(100);
  });

  it("通貨ごとの小数の桁を守る(円に小数・ドルに3桁は受け付けない)", () => {
    expect(parseMajor("1,234", "JPY")).toEqual(money(1234, "JPY"));
    expect(parseMajor("12.3", "USD")).toEqual(money(1230, "USD"));
    expect(() => parseMajor("12.5", "JPY")).toThrow();
    expect(() => parseMajor("1.234", "USD")).toThrow();
    expect(toMajorString(money(-5, "USD"))).toBe("-0.05");
  });

  it("違う通貨は足せない・小数の金額は作れない", () => {
    expect(() => sum([money(1, "JPY"), money(1, "USD")], "JPY")).toThrow();
    expect(() => money(1.5, "JPY")).toThrow();
  });

  it("画面に出す形", () => {
    expect(formatMoney(money(1234567, "JPY"))).toBe("￥1,234,567");
    expect(formatMoney(money(1234, "USD"), "en-US")).toBe("$12.34");
  });
});

describe("時刻", () => {
  it("瞬間は UTC だけ・日付は YYYY-MM-DD だけ", () => {
    expect(InstantSchema.safeParse("2026-10-18T01:00:00.000Z").success).toBe(true);
    expect(InstantSchema.safeParse("2026-10-18T10:00:00+09:00").success).toBe(false);
    expect(DateOnlySchema.safeParse("2026-10-18").success).toBe(true);
    expect(DateOnlySchema.safeParse("2026-10-18T00:00:00Z").success).toBe(false);
  });

  it("時間帯は名前で(+09:00 や JST ではなく)", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("+09:00")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("同じ瞬間でも、時間帯によって日付が違う", () => {
    // UTC 10/17 15:30 = 日本 10/18 0:30
    expect(toLocalDate("2026-10-17T15:30:00Z", "Asia/Tokyo")).toBe("2026-10-18");
    expect(toLocalDate("2026-10-17T15:30:00Z", "UTC")).toBe("2026-10-17");
  });

  it("「1日」の範囲は組織の時間帯で区切る(日本の 10/18 は UTC の 10/17 15:00 から)", () => {
    const { start, end } = localDayRange("2026-10-18", "Asia/Tokyo");
    expect(start.toISOString()).toBe("2026-10-17T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });

  it("夏時間に入る日は23時間(アメリカ東部 2026-03-08)", () => {
    const { start, end } = localDayRange("2026-03-08", "America/New_York");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });
});
