import type { ReactNode } from "react";

export type EmptyStateProps = {
  /** 何が無いか(「まだプロジェクトはありません」) */
  title: string;
  /** 何をすれば増えるか(「上の欄に名前を入れて作れます」)。見るだけの人には、誰に頼めばよいか */
  description?: ReactNode;
  /** その場でできる操作(Button を1つ)。無ければ出さない */
  action?: ReactNode;
};

/**
 * 空のときの表示。「無い」だけで終わらせず、何をすれば増えるか・その操作を同じ形で出す
 * (手引き docs/guides/ux-review.md の 3・🎨 の棚卸しの所見 8)。Table の emptyState にも渡せる。
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}
