import { Button, Heading, Inline, Muted, Stack, TextField } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { useAction } from "../use-action.ts";

// 運営の社員が、お客さんから聞いたサポート番号で、その組織を「見るだけ」で開く(docs/specs/0004-support-access.md)。
// 組織の一覧は無い(番号が無いと、どこにも入れない)。
export function SupportStaffPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const entering = useAction();

  async function enter(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    const ok = await entering.run(() => api.startSupport({ code }), { showErrorAs: "inline" });
    if (!ok) return;
    // 自分の組織のデータを画面の覚え(キャッシュ)に残さない
    router.clearCache();
    await router.navigate({ to: "/" });
  }

  return (
    <Stack gap={4}>
      <Heading level={1}>サポート</Heading>
      <Muted>
        お客さんの管理者から聞いたサポート番号を入れると、その組織を閲覧者として見られます(最長1時間)。
        入った・見た・出たは、お客さんの監査ログに残ります。
      </Muted>
      <form onSubmit={enter}>
        <Inline gap={2}>
          <TextField
            label="サポート番号"
            value={code}
            onChange={setCode}
            placeholder="例: K7QM-2XPA-9DNE"
            isInvalid={entering.errorMessage !== undefined}
            errorMessage={entering.errorMessage}
          />
          <Button type="submit" variant="primary" isDisabled={entering.pending}>
            入る
          </Button>
        </Inline>
      </form>
    </Stack>
  );
}
