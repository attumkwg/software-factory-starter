import { type OrganizationMember, SSO_EXEMPT_MAX, type SsoSettings } from "@app/shared";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Heading,
  Inline,
  Muted,
  Stack,
} from "@app/ui";
import { useState } from "react";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";

// 会社のアカウント(SSO)の必須と緊急用(管理者だけ。プランの機能 sso。docs/specs/0056-sso-scim-ip-audit-export.md)。
// IdP をつなぐ・外すのは運営(お客さんの情シスと打ち合わせて。docs/runbooks/sso.md の 4)。この欄はつないだ後の設定だけ。
// 必須にすると、確かめたドメインの人はパスワードで入れなくなる(すぐ効く)。緊急用の管理者だけは、IdP が止まったときのために
// パスワード+二段階認証で入れる。必須にするには緊急用が1人以上要る(守りは API。409)。

type Props = { state: SsoSettings; admins: OrganizationMember[] };

export function SsoCard({ state, admins }: Props) {
  const [exempt, setExempt] = useState<string[]>(state.exemptUserIds);
  const saving = useAction();
  const changed = exempt.join() !== state.exemptUserIds.join();
  const save = (required: boolean) =>
    saving.run(() => api.putSso({ required, exemptUserIds: exempt }), {
      success: required ? "必須にしました" : "保存しました",
      showErrorAs: "inline",
    });
  const toggle = (id: string, on: boolean) =>
    setExempt((now) => (on ? [...now, id] : now.filter((x) => x !== id)));

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Heading level={2}>会社のアカウント(SSO)</Heading>
          <Badge tone={statusTone(state)}>{statusLabel(state)}</Badge>
        </Inline>
        {!state.connected ? (
          <Muted>
            会社の IdP
            はまだつながっていません。つなぐときは運営に依頼してください(先に会社のドメインを確かめておきます)。
          </Muted>
        ) : (
          <>
            <Muted>
              必須にすると、確かめたドメインのメールの人は、会社のアカウントでしかログインできなくなります。IdP
              が止まったときのために、パスワードで入れる緊急用の管理者を選んでください(
              {SSO_EXEMPT_MAX} 人まで。二段階認証が必須)。
            </Muted>
            <Stack gap={1}>
              {admins.map((a) => (
                <Checkbox
                  key={a.id}
                  strikeWhenSelected={false}
                  isSelected={exempt.includes(a.id)}
                  isDisabled={
                    saving.pending || (!exempt.includes(a.id) && exempt.length >= SSO_EXEMPT_MAX)
                  }
                  onChange={(on) => toggle(a.id, on)}
                >
                  緊急用: {a.name}({a.email})
                </Checkbox>
              ))}
            </Stack>
            {saving.errorMessage ? <Muted>{saving.errorMessage}</Muted> : null}
            <Inline gap={2}>
              {state.required ? (
                <Button variant="secondary" isDisabled={saving.pending} onPress={() => save(false)}>
                  必須を切る
                </Button>
              ) : (
                <ConfirmDialog
                  trigger={
                    <Button variant="primary" isDisabled={exempt.length === 0}>
                      必須にする
                    </Button>
                  }
                  title="会社のアカウントを必須にしますか"
                  confirmLabel="必須にする"
                  onConfirm={async () => {
                    await save(true);
                  }}
                >
                  確かめたドメインのメールの人は、次の操作から、会社のアカウントでログインし直すことになります。緊急用の管理者だけは、パスワードと二段階認証で入れます。
                </ConfirmDialog>
              )}
              {changed && (
                <Button
                  variant="secondary"
                  isDisabled={saving.pending}
                  onPress={() => save(state.required)}
                >
                  緊急用を保存
                </Button>
              )}
            </Inline>
          </>
        )}
      </Stack>
    </Card>
  );
}

const statusLabel = (s: SsoSettings) =>
  !s.connected ? "つないでいない" : s.required ? "必須" : "つないだ(任意)";
const statusTone = (s: SsoSettings) => (s.required ? "success" : "neutral");
