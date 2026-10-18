import {
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
  RouterProvider,
} from "react-aria-components";
import { cx } from "../cx.ts";

export type LinkProps = Omit<AriaLinkProps, "className" | "style" | "href"> & {
  /** 行き先(アプリの中のパス)。本物の <a href> になるので、新しいタブで開ける・SSR でも辿れる */
  href: string;
  /** inline: 文中・一覧のリンク / back: 「← 戻る」の小さなリンク */
  variant?: "inline" | "back";
};

/** ページの移動。押す操作(保存・削除など)には Button を使う。 */
export function Link({ variant = "inline", ...props }: LinkProps) {
  return <AriaLink {...props} className={cx("ui-link", `ui-link--${variant}`)} />;
}

/**
 * Link をアプリのルーターにつなぐ(全体の1か所で包む)。
 * これが無いと、Link はページを丸ごと読み直す移動になる。
 */
export const LinkRouterProvider = RouterProvider;
