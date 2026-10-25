// evidence-monthly: 毎月の証跡の収集(evidence.yml)が、35日のうちに成功したか(毎月1日に流す+少しの余裕)。
import { addDays } from "../phase.mjs";
import { workflowSucceeded } from "../queries.mjs";

export async function check(ctx) {
  return workflowSucceeded(ctx, "evidence.yml", "毎月の証跡の収集", addDays(ctx.today, -35));
}
