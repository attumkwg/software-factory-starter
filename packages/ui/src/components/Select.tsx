import {
  Select as AriaSelect,
  Button,
  type Key,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  SelectValue,
} from "react-aria-components";

export type SelectOption = { id: string; label: string };

export type SelectProps = {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
};

/** 選択肢から1つ選ぶ。キーボードでも選べ、読み上げにも対応する。 */
export function Select({ label, options, value, onChange, isDisabled }: SelectProps) {
  return (
    <AriaSelect
      className="ui-field"
      selectedKey={value}
      onSelectionChange={(key: Key | null) => {
        if (key !== null) onChange(String(key));
      }}
      isDisabled={isDisabled}
    >
      <Label className="ui-label">{label}</Label>
      <Button className="ui-select__button">
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </Button>
      <Popover className="ui-popover">
        <ListBox className="ui-listbox" items={options}>
          {(item) => (
            <ListBoxItem id={item.id} className="ui-listbox__item">
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
