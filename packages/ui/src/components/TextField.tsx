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
  type?: "text" | "email" | "search";
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
    <AriaTextField {...props} type={type} className="ui-field">
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
