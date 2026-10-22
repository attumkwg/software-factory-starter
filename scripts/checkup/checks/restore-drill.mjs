// restore-first: DB を戻す訓練(restore-drill.yml)が一度でも成功したか。
import { workflowSucceeded } from "../queries.mjs";

export async function check(ctx) {
  return workflowSucceeded(ctx, "restore-drill.yml", "戻す訓練");
}
