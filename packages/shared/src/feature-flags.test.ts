import { describe, expect, it } from "vitest";
import {
  enabledFeatures,
  FEATURE_FLAGS,
  type FeatureFlagDefinition,
  type FeatureFlagName,
  featureFlagProblems,
  hasFeature,
} from "./feature-flags.ts";

const def = (over: Partial<FeatureFlagDefinition> & Pick<FeatureFlagDefinition, "name">) => ({
  bet: "B-0001",
  description: "説明",
  state: "rollout" as const,
  ...over,
});

describe("機能フラグの定義", () => {
  it("キットの一覧は書き方の決まりを守る", () => {
    expect(featureFlagProblems(FEATURE_FLAGS)).toEqual([]);
  });

  it("名前の形・重なり・賭けの形・空の説明を見つける", () => {
    const problems = featureFlagProblems([
      def({ name: "ok-name" }),
      def({ name: "ok-name" }),
      def({ name: "Bad_Name" }),
      def({ name: "no-bet", bet: "B-1" }),
      def({ name: "kit-flag", bet: "kit" }),
      def({ name: "no-description", description: " " }),
    ]);
    expect(problems).toEqual([
      "ok-name: 名前が重なっている",
      "Bad_Name: 名前は英小文字・数字・「-」(先頭は英字)",
      "no-bet: bet は B-NNNN の形(キットの仕組みは kit)",
      "no-description: 説明が空",
    ]);
  });
});

describe("入っている機能", () => {
  const defs = [
    def({ name: "picked", state: "rollout" }),
    def({ name: "everyone", state: "on" }),
    def({ name: "stopped", state: "off" }),
    def({ name: "not-picked", state: "rollout" }),
  ];

  it("on は全部・rollout は組織の行があるときだけ・off は行があっても出さない(定義の順)", () => {
    expect(enabledFeatures(defs, ["stopped", "picked"])).toEqual(["picked", "everyone"]);
  });

  it("定義に無い名前の行は捨てる(消した機能の行が残っていても効かない)", () => {
    expect(enabledFeatures(defs, ["removed-long-ago"])).toEqual(["everyone"]);
  });

  it("画面の出し分けは、自分の features に名前があるか", () => {
    // キットには機能が1つも無いので、型の上では名前を作れない(書き間違いは typecheck で落ちる)
    const name = "picked" as FeatureFlagName;
    expect(hasFeature({ features: ["picked"] }, name)).toBe(true);
    expect(hasFeature({ features: [] }, name)).toBe(false);
    expect(hasFeature({}, name)).toBe(false);
  });
});
