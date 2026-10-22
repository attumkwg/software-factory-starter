// fuzz-first: ファズ(security-fuzz.yml)が一度でも成功したか。
import { workflowSucceeded } from "../queries.mjs";

export async function check(ctx) {
  return workflowSucceeded(ctx, "security-fuzz.yml", "ファズ");
}
