import { Select, SelectOption } from '@/components/ui/popover-select';

import { FieldLabel } from './field-label';

type SelectFieldProps<T extends string> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
};

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: SelectFieldProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Select
        className="ui-input h-9 rounded-md border border-edge bg-surface-base px-2 text-sm text-fg"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <SelectOption key={option.value} value={option.value}>
            {option.label}
          </SelectOption>
        ))}
      </Select>
    </div>
  );
}
