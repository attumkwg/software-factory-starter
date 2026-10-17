import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cx } from "../cx.ts";

export type ButtonProps = Omit<AriaButtonProps, "className" | "style"> & {
  /** primary: 主な操作(1画面に1つ) / secondary: ふつう / danger: 消すなど戻せない / ghost: 文字だけ */
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "sm";
};

/** ボタン。クリック・タップ・キーボード(Enter / Space)で押せる。 */
export function Button({ variant = "secondary", size = "md", ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={cx("ui-button", `ui-button--${variant}`, size === "sm" && "ui-button--sm")}
    />
  );
}
