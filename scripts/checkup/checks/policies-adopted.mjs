// policies-adopt: 規程のひな形(docs/compliance/policies/)が自社の物になったか(制定日があり、「要記入」が残っていない)。
import { loadPolicies, notAdoptedPolicies, POLICIES_DIR } from "../../compliance/lib.mjs";

export async function check(ctx) {
  const policies = loadPolicies(
    ctx.files(POLICIES_DIR).map((f) => ({ file: f, text: ctx.read(f) })),
  );
  if (policies.length === 0) return { result: "fail", note: `${POLICIES_DIR} に規程が無い` };
  const left = notAdoptedPolicies(policies);
  return left.length === 0
    ? { result: "pass", note: `規程 ${policies.length}件が制定済み` }
    : {
        result: "fail",
        note: `まだひな形のまま(制定日が無いか「要記入」が残る): ${left.map((p) => p.file.split("/").pop()).join("・")}`,
      };
}
