import {
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  FieldError,
  Input,
  Label,
  Text,
} from "react-aria-components";

export type TextFieldProps = Omit<AriaTextFieldProps, "className" | "style" | "children"> & {
  /** 見える名前(必ず付ける。読み上げにも使う) */
  label: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  /**
   * password は伏せて表示する(autoComplete に current-password / new-password を付ける)。
   * date はブラウザの日付の入力(値は YYYY-MM-DD)
   */
  type?: "text" | "email" | "search" | "password" | "date";
};

/** 1行の入力。名前・説明・エラーを入力欄に結び付ける。 */
export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  type = "text",
  ...props
}: TextFieldProps) {
  return (
    // 失敗の印(isInvalid)は読み上げにだけ付ける(aria)。既定の native はブラウザの検証にも付けるので、
    // サーバーの失敗を出したあと、直して押しても送信を止められてしまう(e2e/errors.spec.ts)
    <AriaTextField validationBehavior="aria" {...props} type={type} className="ui-field">
      <Label className="ui-label">{label}</Label>
      <Input className="ui-input" placeholder={placeholder} />
      {description && (
        <Text slot="description" className="ui-description">
          {description}
        </Text>
      )}
      <FieldError className="ui-error">{errorMessage}</FieldError>
    </AriaTextField>
  );
}
