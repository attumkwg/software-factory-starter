import type { ReactNode } from "react";
import { cx } from "../cx.ts";

type Gap = 1 | 2 | 3 | 4 | 6;

/** 縦に並べる。間は余白のトークン(--space-*)だけ。 */
export function Stack({ gap = 4, children }: { gap?: Gap; children: ReactNode }) {
  return <div className={cx("ui-stack", `ui-gap-${gap}`)}>{children}</div>;
}

/** 横に並べる(はみ出したら折り返す)。 */
export function Inline({
  gap = 2,
  justify,
  align,
  children,
}: {
  gap?: Gap;
  justify?: "between";
  align?: "center";
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "ui-inline",
        `ui-gap-${gap}`,
        justify === "between" && "ui-justify-between",
        align === "center" && "ui-align-center",
      )}
    >
      {children}
    </div>
  );
}

/** 囲み。 */
export function Card({ children }: { children: ReactNode }) {
  return <div className="ui-card">{children}</div>;
}

/** 見出し。level は文書の構造(h1 / h2)に合わせる。 */
export function Heading({ level, children }: { level: 1 | 2; children: ReactNode }) {
  const Tag = level === 1 ? "h1" : "h2";
  return <Tag className={cx("ui-heading", `ui-heading--${level}`)}>{children}</Tag>;
}

/** 補足の文字(薄い色)。 */
export function Muted({ children }: { children: ReactNode }) {
  return <p className="ui-text-muted">{children}</p>;
}

/** 画面の外枠(幅をそろえ、左右に余白)。1画面に1つ。 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="ui-page">{children}</div>;
}

/** 箇条の一覧(ul)。label は読み上げで使う一覧の名前。 */
export function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="ui-list">
      {children}
    </ul>
  );
}
