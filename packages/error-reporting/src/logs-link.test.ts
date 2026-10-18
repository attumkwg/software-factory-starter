import { describe, expect, it } from "vitest";
import { logsInsightsUrl, requestQuery } from "./logs-link.ts";

describe("Sentry の1件からログを開くリンク", () => {
  const url = logsInsightsUrl(
    { region: "ap-northeast-1", logGroups: ["/ecs/sfs-prod", "/ecs/sfs-prod-web"] },
    "f9e8c67c-904d-40bb-980f-a32a99762d7d",
    new Date("2026-10-18T11:30:00Z"),
  );

  it("コンソールの Logs Insights の形(検索の中身を埋め込む)", () => {
    expect(
      url.startsWith(
        "https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#logsV2:logs-insights$3FqueryDetail$3D~(end~'",
      ),
    ).toBe(true);
    // 前後15分・API と画面の2つのロググループ
    expect(url).toContain("2026-10-18T11*3a45*3a00.000Z");
    expect(url).toContain("2026-10-18T11*3a15*3a00.000Z");
    expect(url).toContain("~source~(~'*2fecs*2fsfs-prod~'*2fecs*2fsfs-prod-web))");
    expect(url).toContain("f9e8c67c-904d-40bb-980f-a32a99762d7d");
  });

  it("クエリに入るのは requestId の形の文字だけ(クエリを書き換えられない)", () => {
    expect(requestQuery('x" | delete')).toContain('filter requestId = "xdelete"');
  });
});
