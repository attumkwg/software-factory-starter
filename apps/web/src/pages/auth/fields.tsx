import { PASSWORD_RULES_TEXT } from "@app/shared";
import { Alert, Button, TextField } from "@app/ui";

// ログイン・登録・再設定の画面で使う入力欄。見た目は @app/ui の部品だけ。

export function EmailField(props: { value: string; onChange: (v: string) => void }) {
  return (
    <TextField
      label="メールアドレス"
      type="email"
      autoComplete="username"
      isRequired
      value={props.value}
      onChange={props.onChange}
    />
  );
}

/** current … ログイン(覚えているパスワード)/ new … 登録・再設定(決まりを出す) */
export function PasswordField(props: {
  kind: "current" | "new";
  value: string;
  onChange: (v: string) => void;
  errorMessage?: string;
}) {
  return (
    <TextField
      label={props.kind === "current" ? "パスワード" : "新しいパスワード"}
      type="password"
      autoComplete={props.kind === "current" ? "current-password" : "new-password"}
      isRequired
      value={props.value}
      onChange={props.onChange}
      description={props.kind === "new" ? PASSWORD_RULES_TEXT : undefined}
      isInvalid={props.errorMessage !== undefined}
      errorMessage={props.errorMessage}
    />
  );
}

/** 確認コード・二段階認証のコード(数字6桁) */
export function CodeField(props: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <TextField
      label={props.label}
      description={props.description}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      isRequired
      value={props.value}
      onChange={(v) => props.onChange(v.replace(/\D/g, ""))}
    />
  );
}

/** 失敗の文(messages.ts の固定の文)。無ければ何も出さない */
export function FormError({ message }: { message: string | null }) {
  return message ? <Alert>{message}</Alert> : null;
}

/** 送るボタン。isDisabled … 送る前に足りない物がある(同意のチェックなど) */
export function Submit({
  pending,
  isDisabled = false,
  children,
}: {
  pending: boolean;
  isDisabled?: boolean;
  children: string;
}) {
  return (
    <div>
      <Button type="submit" variant="primary" isDisabled={pending || isDisabled}>
        {children}
      </Button>
    </div>
  );
}
