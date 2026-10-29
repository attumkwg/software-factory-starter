import { readFileSync } from "node:fs";
import type { AuditEvent } from "@app/shared";
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_LABELS,
  auditActionLabel,
  auditActorLabel,
  auditTargetLabel,
} from "./audit-labels.ts";

/**
 * API の監査ログの名前(apps/api/src/audit/actions.ts)を、ファイルの文字から拾う。
 * 画面から API のコードは import しない(別のサービス)ので読むだけ。コメントの行と行の終わりのコメントは飛ばし、
 * 「"」で囲まれた中で、点を含み・空白と「/」を含まない物(project.create など)を名前とみなす。
 */
function apiActionNames(): string[] {
  const text = readFileSync(new URL("../../api/src/audit/actions.ts", import.meta.url), "utf8");
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const parts = trimmed.split('"');
    for (let i = 1; i < parts.length; i += 2) {
      // 「"」の外に「//」があれば、そこから後ろは行の終わりのコメント
      if ((parts[i - 1] as string).includes("//")) break;
      const s = parts[i] as string;
      if (s.includes(".") && !s.includes(" ") && !s.includes("/")) names.add(s);
    }
  }
  return [...names];
}

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

  it("API の監査ログの名前に、全部の文がある(無いと画面に名前がそのまま出る)", () => {
    const names = apiActionNames();
    // 拾い方が壊れて0件で通るのを防ぐ(関所の名前・手で残す名前・代理の社員の読み)
    expect(names).toEqual(expect.arrayContaining(["project.create", "auth.login", "support.read"]));
    expect(names.filter((name) => !(name in AUDIT_ACTION_LABELS))).toEqual([]);
  });

  it("対象: 種類と ID の終わり", () => {
    expect(auditTargetLabel(base)).toBe("タスク 0000a301");
    expect(auditTargetLabel({ ...base, target: null })).toBe("—");
  });
});
