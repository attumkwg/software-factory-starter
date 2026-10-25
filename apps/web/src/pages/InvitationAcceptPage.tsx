import type { AcceptedInvitation, AuthOptions } from "@app/shared";
import { Alert, Card, Heading, Inline, Link, Muted, Page, Stack, TextField } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { AUTH_NOTICES } from "../messages.ts";
import { FormError, Submit } from "./auth/fields.tsx";
import { useSubmit } from "./auth/use-submit.ts";

// 招待を受ける画面(ログインの前。docs/specs/0027-invitations.md)。名前を入れて「参加する」→
// その組織に入る。そのあと、招待のメールアドレスで登録(初めて)かログインすると使える。
// リンクの札は URL の # の後ろにあり、押したときに読む(描くときに window を触らない)。送ったら URL から消す。

export function InvitationAcceptPage({ options }: { options: AuthOptions }) {
  const { submit, pending, error } = useSubmit();
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null);
  const [missing, setMissing] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const token = window.location.hash.slice(1);
    setMissing(!token);
    if (!token) return;
    const r = await submit(() => api.acceptInvitation(token, name));
    if (!r) return;
    window.history.replaceState(null, "", "/invitation");
    setAccepted(r);
  }

  return (
    <Page>
      <main>
        <Card>
          <Stack gap={4}>
            <Heading level={1}>招待を受ける</Heading>
            {accepted ? (
              <Joined accepted={accepted} options={options} />
            ) : (
              <form onSubmit={onSubmit}>
                <Stack gap={4}>
                  <Muted>
                    組織の中で見せる名前を入れて「参加する」を押してください。リンクは1回だけ使えます。
                  </Muted>
                  <FormError message={missing ? AUTH_NOTICES.invitationLinkMissing : error} />
                  <TextField
                    label="名前"
                    autoComplete="name"
                    isRequired
                    maxLength={100}
                    value={name}
                    onChange={setName}
                  />
                  <Submit pending={pending}>参加する</Submit>
                </Stack>
              </form>
            )}
          </Stack>
        </Card>
      </main>
    </Page>
  );
}

function Joined({ accepted, options }: { accepted: AcceptedInvitation; options: AuthOptions }) {
  return (
    <Stack gap={4}>
      <Alert tone="info">{accepted.tenantName} に参加しました。</Alert>
      <Muted>
        続けて、招待されたメールアドレス({accepted.email})で
        {options.method === "cognito" ? "登録(初めての方)してから、" : ""}
        ログインしてください。
      </Muted>
      <Inline gap={3}>
        {options.method === "cognito" ? <Link href="/sign-up">登録する</Link> : null}
        <Link href="/login">ログインする</Link>
      </Inline>
    </Stack>
  );
}
