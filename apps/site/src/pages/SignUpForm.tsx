import { COMPANY_SIZES, currentPreRegistrationConsent } from "@app/shared";
import { Alert, Button, Checkbox, Inline, Muted, Select, Stack, TextField } from "@app/ui";
import { useState } from "react";
import { postPublic } from "../api.ts";
import type { SiteConfig } from "../config.ts";
import { CONTENT } from "../content.ts";
import { sourceFromSearch } from "../source.ts";

// 事前登録の形(docs/guides/landing-page.md の「同意の文の型」)。同意の文は @app/shared の最後の版をそのまま出し、
// その版の番号を一緒に送る(古いページから送ると 400 になり、読み込み直してもらう)。
// 集めるのは会社名・メールアドレス・会社の規模の幅だけ。自由記述の欄は置かない。

type State = "idle" | "sending" | "sent" | "rejected" | "failed";

const SIZE_OPTIONS = [
  { id: "", label: "選ばない" },
  ...COMPANY_SIZES.map((size) => ({ id: size, label: `${size} 人` })),
];

/** 罠の欄(人には見えない。機械が埋めたら、API が何もせずに同じ答えを返す) */
function Trap({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}>
      <label>
        この欄は空のままにしてください
        <input
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

function Result({ state }: { state: State }) {
  if (state === "rejected") {
    return <Alert>入力を確かめてください。直らないときは、ページを読み込み直してください。</Alert>;
  }
  if (state === "failed") {
    return <Alert>送れませんでした。時間をおいて、もう一度お試しください。</Alert>;
  }
  return null;
}

export function SignUpForm({ config }: { config: SiteConfig }) {
  const consent = currentPreRegistrationConsent();
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<State>("idle");

  if (state === "sent") {
    return (
      <Alert tone="info">
        確認のメールを送りました。メールのリンクを開いて、登録を確かめてください(7日で切れます)。
      </Alert>
    );
  }

  const submit = async () => {
    setState("sending");
    const result = await postPublic(config.appUrl, "pre-registrations", {
      email,
      organizationName,
      ...(companySize ? { companySize } : {}),
      consent: true,
      consentTextVersion: consent.version,
      ...sourceFromSearch(window.location.search),
      landingPath: window.location.pathname,
      website,
    });
    setState(result === "ok" ? "sent" : result === "bad_request" ? "rejected" : "failed");
  };

  return (
    <Stack gap={3}>
      <TextField
        label="会社名"
        value={organizationName}
        onChange={setOrganizationName}
        maxLength={100}
      />
      <TextField
        label="メールアドレス"
        type="email"
        value={email}
        onChange={setEmail}
        maxLength={254}
      />
      <Select
        label="会社の規模"
        options={SIZE_OPTIONS}
        value={companySize}
        onChange={setCompanySize}
      />
      <Trap value={website} onChange={setWebsite} />
      <Muted>
        {consent.text.replaceAll("{サービス名}", CONTENT.productName)}詳しくは
        <a href={`${config.appUrl}/legal/privacy`} className="ui-link ui-link--inline">
          プライバシーポリシー
        </a>
        をご覧ください。
      </Muted>
      <Checkbox isSelected={agreed} onChange={setAgreed}>
        {consent.checkbox}
      </Checkbox>
      <Result state={state} />
      <Inline>
        <Button
          variant="primary"
          isDisabled={!agreed || !organizationName || !email || state === "sending"}
          onPress={submit}
        >
          登録する
        </Button>
      </Inline>
    </Stack>
  );
}
