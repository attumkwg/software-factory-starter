import { AUDIT_EXPORT_MAX_DAYS, toLocalDate } from "@app/shared";
import { Button, Card, Heading, Inline, Muted, Stack, TextField } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { saveAsFile } from "../../save-as-file.ts";
import { useAction } from "../../use-action.ts";

// 監査ログの書き出し(管理者だけ。プランの機能 audit-export。docs/specs/0056-sso-scim-ip-audit-export.md の段3)。
// 期間(日付・両端を含む・最長 366 日)を選ぶと、1行1件の JSON(JSON Lines)で古い順に保存される。
// 情シスの道具(SIEM など)に取り込む用。書き出したことも監査ログに残る。

export function AuditExportCard({ timeZone }: { timeZone: string }) {
  const today = toLocalDate(new Date(), timeZone);
  const monthAgo = toLocalDate(new Date(Date.now() - 30 * 86_400_000), timeZone);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const exporting = useAction();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await exporting.run(async () => saveAsFile(await api.exportAuditEvents({ from, to })), {
      success: "書き出しました",
      showErrorAs: "inline",
    });
  }

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>書き出し</Heading>
        <Muted>
          期間({AUDIT_EXPORT_MAX_DAYS} 日まで)を選ぶと、1行1件の JSON(JSON
          Lines)で古い順に保存します。書き出したことも記録に残ります。
        </Muted>
        <form onSubmit={onSubmit}>
          <Inline gap={2}>
            <TextField label="いつから" type="date" isRequired value={from} onChange={setFrom} />
            <TextField
              label="いつまで"
              type="date"
              isRequired
              value={to}
              onChange={setTo}
              isInvalid={exporting.errorMessage !== undefined}
              errorMessage={exporting.errorMessage}
            />
            <div>
              <Button type="submit" variant="secondary" isDisabled={exporting.pending}>
                書き出す
              </Button>
            </div>
          </Inline>
        </form>
      </Stack>
    </Card>
  );
}
