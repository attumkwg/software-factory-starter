import { expect, type Page } from "@playwright/test";
import { operator } from "./operator.ts";

// 一周の E2E(journey.spec.ts)の 9: 本人の求めで1人分を消す(運営。試し → 本当に消す。
// docs/runbooks/person-data.md の 5・docs/specs/0089-person-erase.md)。admin は「組織の人」を開いている管理者。
export async function erasePerson(
  admin: Page,
  tenantId: string,
  userId: string,
  memberEmail: string,
) {
  const plan = operator(["person-data", tenantId, userId]);
  expect(plan).toMatchObject({ mode: "plan", found: true });
  const totals = plan.totals as { anonymize: number; delete: number };
  const rows = String(totals.anonymize + totals.delete);
  const done = operator(["person-data", tenantId, userId, "--execute", "--confirm-rows", rows]);
  expect(done).toMatchObject({ mode: "erased", found: true });
  // 流し直した試しで、消す物が0(手順書の確かめ)
  const again = operator(["person-data", tenantId, userId]);
  expect(again).toMatchObject({ totals: { delete: 0 } });
  // 管理者の「組織の人」で、名前とメールが置き換わり、止めたまま
  await admin.reload();
  await expect(admin.getByRole("row", { name: /一周 花子/ })).toHaveCount(0);
  await expect(admin.getByText(memberEmail)).toHaveCount(0);
  await expect(
    admin.getByRole("row", { name: /削除した利用者/ }).getByText("止めた"),
  ).toBeVisible();
}
