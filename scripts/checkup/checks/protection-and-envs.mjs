// w-protection: ブランチ保護と Environments が外れていないか・.github/setup.yml とずれていないか(毎週。3つの確かめをまとめる)。
import { check as environments } from "./github-environments.mjs";
import { check as protection } from "./github-protection.mjs";
import { check as drift } from "./setup-drift.mjs";

export async function check(ctx) {
  const results = [await protection(ctx), await environments(ctx), await drift(ctx)];
  const result = results.some((r) => r.result === "fail")
    ? "fail"
    : results.some((r) => r.result === "unknown")
      ? "unknown"
      : "pass";
  return { result, note: results.map((r) => r.note).join(" / ") };
}
