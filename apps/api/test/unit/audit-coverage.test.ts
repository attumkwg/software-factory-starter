import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "../../src/audit/actions.ts";
import { PUBLIC, ROUTE_RULES } from "../../src/authz/policy.ts";

// 監査ログの網羅: ログインが要る書き込みの API(GET 以外)には、必ず監査ログの名前がある。
// AI が書き込みの API を足しても、src/audit/actions.ts に1行足さない限りここで落ちる
// (記録は認可の関所が自動で取るので、名前さえあれば書き忘れない)。

const writeRoutes = Object.entries(ROUTE_RULES)
  .filter(([route, rule]) => rule !== PUBLIC && !route.startsWith("GET "))
  .map(([route]) => route);

describe("監査ログ(src/audit/actions.ts)の網羅", () => {
  it("書き込みの API には、全部に監査ログの名前がある", () => {
    const missing = writeRoutes.filter((r) => !AUDIT_ACTIONS[r]);
    expect(missing, "src/audit/actions.ts に1行足してください(名前は「対象.動作」)").toEqual([]);
  });

  it("もう無い API の名前が残っていない", () => {
    const stale = Object.keys(AUDIT_ACTIONS).filter((r) => !writeRoutes.includes(r));
    expect(stale).toEqual([]);
  });

  it("名前は「対象.動作」の形で、重ならない", () => {
    const names = Object.values(AUDIT_ACTIONS).map((a) => a.action);
    for (const n of names) expect(n).toMatch(/^[a-z_]+\.[a-z_]+$/);
    expect(new Set(names).size).toBe(names.length);
  });
});
