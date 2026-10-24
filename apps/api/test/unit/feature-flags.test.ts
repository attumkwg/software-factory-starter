import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_FLAGS, type FeatureFlagDefinition, featureFlagProblems } from "@app/shared";
import { describe, expect, it } from "vitest";

// 機能フラグは賭けに結びつく(docs/designs/0012-feature-flags-and-usage.md の 4)。
// 賭けをやめた・撤去したのにフラグが残っていたら、ここで落ちる(消し忘れを残さない)。

const BETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../docs/product/bets");

/** 賭けの ID → 段階(ファイルの「- 段階: <段階>」の行。scripts/bets-lib.mjs と同じ所を読む) */
function readBetStages(): Map<string, string> {
  const stages = new Map<string, string>();
  for (const file of readdirSync(BETS_DIR)) {
    const id = file.match(/^(B-\d{4})-.+\.md$/)?.[1];
    if (!id) continue;
    const stage = readFileSync(join(BETS_DIR, file), "utf8").match(/^- 段階:\s*(\S+)/m)?.[1];
    if (stage) stages.set(id, stage);
  }
  return stages;
}

/** 賭けの段階ごとに、フラグがあってよいか・状態は何でよいか */
const ALLOWED_STATES: Record<string, readonly FeatureFlagDefinition["state"][]> = {
  psf: ["rollout", "off"],
  rollout: ["rollout", "off"],
  adopted: ["on", "off"],
};

function betProblems(
  defs: readonly FeatureFlagDefinition[],
  stages: ReadonlyMap<string, string>,
): string[] {
  return defs.flatMap((d) => {
    const stage = stages.get(d.bet);
    if (!stage) return [`${d.name}: 賭け ${d.bet} のファイルが docs/product/bets に無い`];
    const allowed = ALLOWED_STATES[stage];
    if (!allowed) {
      return [
        `${d.name}: 賭け ${d.bet} は ${stage}。` +
          (stage === "dropped" || stage === "retired"
            ? "フラグと呼び出しを消す"
            : "まだ作る段階ではない(psf から)"),
      ];
    }
    return allowed.includes(d.state)
      ? []
      : [`${d.name}: 賭けが ${stage} のときの状態は ${allowed.join(" / ")}`];
  });
}

const def = (bet: string, state: FeatureFlagDefinition["state"]): FeatureFlagDefinition => ({
  name: `flag-${bet.toLowerCase()}-${state}`,
  bet,
  description: "説明",
  state,
});

describe("機能フラグと賭け", () => {
  it("キットの一覧は、書き方の決まりと賭けの段階を守る", () => {
    expect(featureFlagProblems(FEATURE_FLAGS)).toEqual([]);
    expect(betProblems(FEATURE_FLAGS, readBetStages())).toEqual([]);
  });

  it("賭けのファイルが読める(見本の賭けの段階が取れる)", () => {
    expect(readBetStages().size).toBeGreaterThan(0);
  });

  it("賭けが無い・まだ作る段階ではない・やめた・状態が合わない を見つける", () => {
    const stages = new Map([
      ["B-0001", "rollout"],
      ["B-0002", "cpf"],
      ["B-0003", "dropped"],
      ["B-0004", "adopted"],
      ["B-0005", "psf"],
    ]);
    expect(
      betProblems(
        [
          def("B-0001", "rollout"),
          def("B-0002", "rollout"),
          def("B-0003", "rollout"),
          def("B-0004", "rollout"),
          def("B-0005", "off"),
          def("B-0009", "on"),
        ],
        stages,
      ),
    ).toEqual([
      "flag-b-0002-rollout: 賭け B-0002 は cpf。まだ作る段階ではない(psf から)",
      "flag-b-0003-rollout: 賭け B-0003 は dropped。フラグと呼び出しを消す",
      "flag-b-0004-rollout: 賭けが adopted のときの状態は on / off",
      "flag-b-0009-on: 賭け B-0009 のファイルが docs/product/bets に無い",
    ]);
  });
});
