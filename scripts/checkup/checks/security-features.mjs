// dep-alerts: Dependabot の通知と secret scanning がオンか。
// どちらも管理者の読み取りが要る(読めなければ unknown)。
import { unknownFrom } from "../gh.mjs";

export async function check(ctx) {
  const alerts = ctx.api("vulnerability-alerts");
  if (!alerts.ok && alerts.status !== 404) return unknownFrom(alerts, "Dependabot の通知の設定");
  const repo = ctx.api("");
  if (!repo.ok) return unknownFrom(repo, "リポジトリの情報");
  const scanningState = repo.data?.security_and_analysis?.secret_scanning?.status;
  if (scanningState === undefined)
    return {
      result: "unknown",
      note: "secret scanning の設定を読めなかった(管理者の読み取りが要る)",
    };
  const off = [!alerts.ok && "Dependabot の通知", scanningState !== "enabled" && "secret scanning"];
  const names = off.filter(Boolean);
  return names.length === 0
    ? { result: "pass", note: "Dependabot の通知・secret scanning ともオン" }
    : { result: "fail", note: `オフ: ${names.join("・")}(Settings → Code security で入れる)` };
}
