import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";

export type ActionMenuItem = {
  id: string;
  label: string;
  /** 消す・止めるなど戻せない操作(赤い文字。押した後に ConfirmDialog か「元に戻す」を通す) */
  isDestructive?: boolean;
};

export type ActionMenuProps = {
  /** 何の操作か(読み上げとテストで使う)。例: 「見積もりを出す の操作」 */
  label: string;
  items: ActionMenuItem[];
  onAction: (id: string) => void;
  isDisabled?: boolean;
};

/**
 * 行の操作のメニュー(「…」)。消す・止めるなど、主な操作の隣に並べると押し間違える物を奥にしまう
 * (手引き docs/guides/ux-review.md の 7・🎨 の棚卸しの所見 1・5・14)。
 * 押す所は 44px 角(手袋・親指でも押せる)。キーボードでも開ける(Enter・Space・矢印)。
 */
export function ActionMenu({ label, items, onAction, isDisabled }: ActionMenuProps) {
  return (
    <MenuTrigger>
      <AriaButton className="ui-action-menu__trigger" aria-label={label} isDisabled={isDisabled}>
        <span aria-hidden="true">…</span>
      </AriaButton>
      <Popover className="ui-popover" placement="bottom end">
        <Menu className="ui-menu" onAction={(key) => onAction(String(key))}>
          {items.map((item) => (
            <MenuItem
              key={item.id}
              id={item.id}
              className={
                item.isDestructive ? "ui-menu__item ui-menu__item--danger" : "ui-menu__item"
              }
            >
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
