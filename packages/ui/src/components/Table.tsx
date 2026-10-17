import type { ReactNode } from "react";
import {
  Cell as AriaCell,
  Column as AriaColumn,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableHeader as AriaTableHeader,
} from "react-aria-components";

export type TableColumn<T> = {
  id: string;
  header: string;
  /** 1つの表に1つだけ。行の名前(読み上げ)になる */
  isRowHeader?: boolean;
  cell: (row: T) => ReactNode;
};

export type TableProps<T extends { id: string }> = {
  /** 表の名前(見えなくても読み上げで使う) */
  label: string;
  columns: TableColumn<T>[];
  rows: T[];
  emptyMessage?: string;
};

/** 表。矢印キーで行と列を動ける。 */
export function Table<T extends { id: string }>({
  label,
  columns,
  rows,
  emptyMessage = "まだありません",
}: TableProps<T>) {
  return (
    <AriaTable aria-label={label} className="ui-table">
      <AriaTableHeader columns={columns}>
        {(col) => (
          <AriaColumn id={col.id} isRowHeader={col.isRowHeader} className="ui-table__column">
            {col.header}
          </AriaColumn>
        )}
      </AriaTableHeader>
      <AriaTableBody
        items={rows}
        renderEmptyState={() => <p className="ui-text-muted">{emptyMessage}</p>}
      >
        {(row) => (
          <AriaRow id={row.id} columns={columns} className="ui-table__row">
            {(col) => <AriaCell className="ui-table__cell">{col.cell(row)}</AriaCell>}
          </AriaRow>
        )}
      </AriaTableBody>
    </AriaTable>
  );
}
