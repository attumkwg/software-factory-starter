import { Alert, Button, Checkbox, Heading, Inline, Muted, Stack, TextField } from "@app/ui";
import { useState } from "react";

// ④ 申し込みの形の見本(③ お金の段で使う)。メールアドレスは個人情報なので、
// 集めるなら「何に使うか」の一文と、同意のチェックを必ず付ける(docs/guides/prototypes.md)。
// この試作は、どこにも送らない・保存しない(押すと、そう伝えるだけ)。
export function SignUp() {
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Stack gap={4}>
      <Heading level={1}>朝のまとめを先に試す</Heading>
      <Muted>正式に出す前に、少人数で試してもらう人を探しています(架空の案内)。</Muted>
      <TextField label="メールアドレス" type="email" value={email} onChange={setEmail} />
      <Muted>
        利用目的:
        いただいたメールアドレスは、この機能の試用のご案内を送るためだけに使い、試用が終わったら消します。
      </Muted>
      <Checkbox isSelected={agreed} onChange={setAgreed}>
        上の利用目的に同意する
      </Checkbox>
      <Inline>
        <Button
          variant="primary"
          isDisabled={!agreed || email.length === 0}
          onPress={() => setDone(true)}
        >
          試用を申し込む
        </Button>
      </Inline>
      {done && (
        <Alert tone="info">
          ありがとうございます。これは試作なので、入力したメールアドレスはどこにも送らず、保存もしていません。
        </Alert>
      )}
    </Stack>
  );
}
