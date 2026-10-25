// policy-review: 見直しの日(頭の next_review)を過ぎた規程が無いか。
import { loadPolicies, POLICIES_DIR, reviewDuePolicies } from "../../compliance/lib.mjs";

export async function check(ctx) {
  const policies = loadPolicies(
    ctx.files(POLICIES_DIR).map((f) => ({ file: f, text: ctx.read(f) })),
  );
  const due = reviewDuePolicies(policies, ctx.today);
  return due.length === 0
    ? { result: "pass", note: "見直しの日を過ぎた規程は無い" }
    : {
        result: "fail",
        note: `見直しの日が来た規程: ${due.map((p) => p.file.split("/").pop()).join("・")}`,
      };
}
