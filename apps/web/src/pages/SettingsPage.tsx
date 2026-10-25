import type { Me, MfaRequirement } from "@app/shared";
import { Button, Card, Heading, Link, Muted, Stack } from "@app/ui";
import { api } from "../api.ts";
import { useAction } from "../use-action.ts";
import { MfaRequirementCard } from "./settings/MfaRequirementCard.tsx";

// 組織の管理者の「設定」。招待(docs/specs/0027-invitations.md)・監査ログ・サポートへの許可・データの書き出し(docs/specs/0005-offboarding.md)・
// 二段階認証の必須(docs/specs/0006-account-security.md)。
export function SettingsPage({ me, mfa }: { me: Me; mfa: MfaRequirement }) {
  const exporting = useAction();

  return (
    <Stack gap={4}>
      <Heading level={1}>設定</Heading>
      <MfaRequirementCard me={me} state={mfa} />
      <Card>
        <Stack gap={2}>
          <Heading level={2}>監査ログ</Heading>
          <Muted>この組織で、誰が・いつ・何をしたかの記録です。</Muted>
          <div>
            <Link href="/audit">監査ログを見る</Link>
          </div>
        </Stack>
      </Card>
      <Card>
        <Stack gap={2}>
          <Heading level={2}>招待</Heading>
          <Muted>メールアドレスとロールを選んで、この組織に人を招きます。</Muted>
          <div>
            <Link href="/invitations">招待を開く</Link>
          </div>
        </Stack>
      </Card>
      <Card>
        <Stack gap={2}>
          <Heading level={2}>サポートへの許可</Heading>
          <Muted>問い合わせのときに、サポートが期限つきで画面を見られるようにします。</Muted>
          <div>
            <Link href="/support-access">サポートへの許可を開く</Link>
          </div>
        </Stack>
      </Card>
      <Card>
        <Stack gap={2}>
          <Heading level={2}>データの書き出し</Heading>
          <Muted>
            この組織のデータ(利用者・プロジェクト・タスク・監査ログなど)を、1つの JSON
            ファイルで受け取ります。書き出したことは監査ログに残ります。
          </Muted>
          <div>
            <Button
              variant="secondary"
              isDisabled={exporting.pending}
              onPress={async () => {
                await exporting.run(async () => saveAsFile(await api.exportData()), {
                  success: "書き出しました",
                });
              }}
            >
              書き出す
            </Button>
          </div>
        </Stack>
      </Card>
    </Stack>
  );
}

/** 受け取った JSON を、読み直さずにブラウザのダウンロードとして保存する(大きい組織でも JS の値にしない) */
function saveAsFile({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
