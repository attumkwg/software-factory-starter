import type { Account, MfaSetup } from "@app/shared";
import { Badge, Button, Card, Heading, Inline, Muted, QrCode, Stack } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";
import { FormError, PasswordField, Submit } from "../auth/fields.tsx";
import { ReauthForm, TotpField } from "./ReauthForm.tsx";
import { groupSecret } from "./secret.ts";

// 二段階認証(TOTP)を有効・無効にする。有効にする: パスワードを入れ直す → QR と鍵 → 認証アプリのコード。
// 外す: パスワードといまのコード(組織が必須なら外せない)。

type Step = "idle" | "reauth" | "scan";

export function MfaCard({ account }: { account: Account }) {
  return (
    <Card>
      <Stack gap={3}>
        <Inline gap={2} align="center">
          <Heading level={2}>二段階認証</Heading>
          <Badge tone={account.mfaEnabled ? "success" : "neutral"}>
            {account.mfaEnabled ? "有効" : "未設定"}
          </Badge>
        </Inline>
        <Muted>
          ログインのとき、パスワードの後に、認証アプリ(Google Authenticator
          など)の6桁のコードを聞きます。
        </Muted>
        {account.mfaEnabled ? <Disable account={account} /> : <Enable />}
      </Stack>
    </Card>
  );
}

function Enable() {
  const [step, setStep] = useState<Step>("idle");
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const action = useAction();

  async function startScan() {
    let created: MfaSetup | null = null;
    const ok = await action.run(async () => {
      created = await api.setupMfa();
    });
    if (ok && created) {
      setSetup(created);
      setStep("scan");
    }
  }

  if (step === "idle") {
    return (
      <div>
        <Button variant="primary" onPress={() => setStep("reauth")}>
          二段階認証を設定する
        </Button>
      </div>
    );
  }
  if (step === "reauth" || !setup) return <ReauthForm mfaEnabled={false} onDone={startScan} />;
  return <Scan setup={setup} />;
}

/** QR と手で入れる鍵を出し、認証アプリのコードで有効にする */
function Scan({ setup }: { setup: MfaSetup }) {
  const action = useAction();
  const [code, setCode] = useState("");
  const key = groupSecret(setup.secret);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await action.run(() => api.enableMfa(code), {
      success: "二段階認証を有効にしました",
      showErrorAs: "inline",
    });
    setCode("");
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap={4}>
        <Muted>認証アプリで QR コードを読むか、下の鍵を手で入れてください。</Muted>
        <QrCode value={setup.otpauthUri} label="認証アプリに読ませる QR コード" />
        <div>
          手で入れる鍵: <code data-testid="mfa-secret">{key}</code>
        </div>
        <FormError message={action.errorMessage ?? null} />
        <TotpField value={code} onChange={setCode} />
        <Submit pending={action.pending}>有効にする</Submit>
      </Stack>
    </form>
  );
}

function Disable({ account }: { account: Account }) {
  const action = useAction();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  if (account.organizationRequiresMfa) {
    return <Muted>この組織では二段階認証が必須なので、外せません。</Muted>;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await action.run(() => api.disableMfa(password, code), {
      success: "二段階認証を外しました",
      showErrorAs: "inline",
    });
    setPassword("");
    setCode("");
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap={4}>
        <Muted>外すと、パスワードだけでログインできるようになります。</Muted>
        <FormError message={action.errorMessage ?? null} />
        <PasswordField kind="current" value={password} onChange={setPassword} />
        <TotpField value={code} onChange={setCode} />
        <div>
          <Button type="submit" variant="danger" isDisabled={action.pending}>
            二段階認証を外す
          </Button>
        </div>
      </Stack>
    </form>
  );
}
