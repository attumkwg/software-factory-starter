import { describe, expect, it } from "vitest";
import { DEMO_RESET_TABLES, demoTarget } from "../../src/demo/index.ts";
import { TENANT_TABLES } from "../../src/offboarding/delete-tenant.ts";

// 営業のデモ用の組織を戻す(docs/designs/0053-sales-kit.md の 6)。DB を使わない。

const DEMO = "0199a000-0000-7000-8000-00000000d001";

describe("デモを戻してよい環境", () => {
  it("APP_ENV をはっきり書いた stg・手元・テスト・プレビューで、DEMO_TENANT_ID があるときだけ", () => {
    for (const appEnv of ["stg", "local", "test", "preview"])
      expect(demoTarget({ APP_ENV: appEnv, DEMO_TENANT_ID: DEMO })).toBe(DEMO);
    expect(() => demoTarget({ APP_ENV: "prod", DEMO_TENANT_ID: DEMO })).toThrow(
      "stg・手元・プレビューだけ",
    );
    // APP_ENV が無い(移行のタスクの既定)なら止まる
    expect(() => demoTarget({ DEMO_TENANT_ID: DEMO })).toThrow("(無い)");
    expect(() => demoTarget({ APP_ENV: "stg" })).toThrow("DEMO_TENANT_ID");
    expect(() =>
      demoTarget({ APP_ENV: "stg", DEMO_TENANT_ID: DEMO, SUPPORT_TENANT_ID: DEMO }),
    ).toThrow("運営の組織");
  });
});

describe("戻す表", () => {
  it("組織・人・契約・入れた機能・同意・監査ログ・要配慮は残し、ほかは解約の削除と同じ順で消す", () => {
    for (const kept of [
      "organizations.tenants",
      "organizations.users",
      "platform.tenant_plans",
      "platform.feature_flags",
      "platform.audit_events",
      "legal.consents",
      "sensitive.tenant_keys",
    ])
      expect(DEMO_RESET_TABLES).not.toContain(kept);
    expect(DEMO_RESET_TABLES).toContain("tasks.tasks");
    expect(DEMO_RESET_TABLES).toContain("projects.projects");
    // 子の表が先(TENANT_TABLES の順のまま)
    const order = DEMO_RESET_TABLES.map((t) => TENANT_TABLES.indexOf(t));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
