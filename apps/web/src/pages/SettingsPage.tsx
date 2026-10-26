import type {
  IpAllowlist,
  Me,
  MfaRequirement,
  OrganizationDomain,
  OrganizationMember,
  SsoSettings,
} from "@app/shared";
import { Button, Card, Heading, Link, Muted, Stack } from "@app/ui";
import { api } from "../api.ts";
import { useAction } from "../use-action.ts";
import { DomainsCard } from "./settings/DomainsCard.tsx";
import { IpAllowlistCard } from "./settings/IpAllowlistCard.tsx";
import { MfaRequirementCard } from "./settings/MfaRequirementCard.tsx";
import { SsoCard } from "./settings/SsoCard.tsx";

// 組織の管理者の「設定」。招待(docs/specs/0027-invitations.md)・監査ログ・サポートへの許可・データの書き出し(docs/specs/0005-offboarding.md)・
// 二段階認証の必須(docs/specs/0006-account-security.md)。組織の人と強制ログアウト・会社のドメイン・IP の制限
// ・会社のアカウント(SSO)(docs/specs/0056-sso-scim-ip-audit-export.md。ドメイン・SSO・IP はプランの機能が入った組織だけ。無ければ null)。
export function SettingsPage({
  me,
  mfa,
  domains,
  ipAllowlist,
  sso,
}: {
  me: Me;
  mfa: MfaRequirement;
  domains: OrganizationDomain[] | null;
  ipAllowlist: IpAllowlist | null;
  sso: { state: SsoSettings; admins: OrganizationMember[] } | null;
}) {
  const exporting = useAction();

  return (
    <Stack gap={4}>
      <Heading level={1}>設定</Heading>
      <MfaRequirementCard me={me} state={mfa} />
      {ipAllowlist && <IpAllowlistCard state={ipAllowlist} />}
      {domains && <DomainsCard domains={domains} />}
      {sso && <SsoCard state={sso.state} admins={sso.admins} />}
      <Card>
        <Stack gap={2}>
          <Heading level={2}>組織の人</Heading>
          <Muted>
            この組織の人の一覧です。端末をなくした人などを、すぐにログアウトさせられます。
          </Muted>
          <div>
            <Link href="/members">組織の人を開く</Link>
          </div>
        </Stack>
      </Card>
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
