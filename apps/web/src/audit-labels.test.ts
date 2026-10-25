import type { AuditEvent } from "@app/shared";
import { describe, expect, it } from "vitest";
import { auditActionLabel, auditActorLabel, auditTargetLabel } from "./audit-labels.ts";

const base: AuditEvent = {
  id: "0199a000-0000-7000-8000-000000000001",
  occurredAt: "2026-10-18T00:00:00.000Z",
  actor: { kind: "user", id: "0199a000-0000-7000-8000-00000000a002", name: "山田" },
  action: "task.update",
  target: { type: "task", id: "0199a000-0000-7000-8000-00000000a301" },
  outcome: "allowed",
  requestId: null,
  details: { fields: ["done", "title"] },
};

describe("監査ログの文", () => {
  it("何を: 名前と、直した項目", () => {
    expect(auditActionLabel(base)).toBe("タスクを直した(完了・題名)");
    expect(auditActionLabel({ ...base, action: "unknown.thing", details: {} })).toBe(
      "unknown.thing",
    );
    expect(
      auditActionLabel({ ...base, action: "feature_flag.enable", details: { flag: "picked" } }),
    ).toBe("機能を入れた(picked)");
    expect(
      auditActionLabel({
        ...base,
        action: "plan.change",
        details: { plan: "standard", priceList: "2026-10" },
      }),
    ).toBe("プランを変えた(standard・価格表 2026-10)");
  });

  it("誰が: 自社の人は名前、社員と仕組みは種類、消された人はそれと分かる文", () => {
    expect(auditActorLabel(base)).toBe("山田");
    expect(auditActorLabel({ ...base, actor: { kind: "support", id: null, name: null } })).toBe(
      "サポート(運営)",
    );
    expect(auditActorLabel({ ...base, actor: { kind: "user", id: base.id, name: null } })).toBe(
      "(いまはいない人)",
    );
  });

  it("対象: 種類と ID の終わり", () => {
    expect(auditTargetLabel(base)).toBe("タスク 0000a301");
    expect(auditTargetLabel({ ...base, target: null })).toBe("—");
  });
});
