import type { ReactNode } from "react";
import { Checkbox as AriaCheckbox } from "react-aria-components";

export type CheckboxProps = {
  children: ReactNode;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  /** 選んだら文字に線を入れるか(完了のタスクなど)。同意のチェックのように線が要らないなら false */
  strikeWhenSelected?: boolean;
};

/** チェック。既定では、選んだら文字に線が入る(完了のタスクなど)。 */
export function Checkbox({
  children,
  isSelected,
  onChange,
  isDisabled,
  strikeWhenSelected = true,
}: CheckboxProps) {
  return (
    <AriaCheckbox
      className={strikeWhenSelected ? "ui-checkbox ui-checkbox--strike" : "ui-checkbox"}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
    >
      {({ isSelected: selected }) => (
        <>
          <span className="ui-checkbox__box" aria-hidden="true">
            {selected ? "✓" : ""}
          </span>
          <span className="ui-checkbox__label">{children}</span>
        </>
      )}
    </AriaCheckbox>
  );
}
