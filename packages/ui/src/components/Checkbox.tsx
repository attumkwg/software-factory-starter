import type { ReactNode } from "react";
import { Checkbox as AriaCheckbox } from "react-aria-components";

export type CheckboxProps = {
  children: ReactNode;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
};

/** チェック。選んだら文字に線が入る(完了のタスクなど)。 */
export function Checkbox({ children, isSelected, onChange, isDisabled }: CheckboxProps) {
  return (
    <AriaCheckbox
      className="ui-checkbox"
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
