import { useState, type ComponentProps } from 'react';

type NumberInputProps = Omit<ComponentProps<'input'>, 'type' | 'defaultValue'> & {
  type?: 'number';
  /** Allow clearing optional values instead of restoring the last committed number. */
  allowEmpty?: boolean;
};

/** Keep editing text separate from numeric state so deletion and intermediate values survive renders. */
export function NumberInput({ value, onChange, onBlur, min, max, allowEmpty = false, ...props }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft ?? value ?? ''}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text === '') {
          if (allowEmpty && !event.target.validity.badInput) onChange?.(event);
          return;
        }
        if (Number.isFinite(event.target.valueAsNumber) &&
          !event.target.validity.rangeUnderflow && !event.target.validity.rangeOverflow) {
          onChange?.(event);
        }
      }}
      onBlur={(event) => {
        const input = event.currentTarget;
        const number = input.valueAsNumber;
        if (draft !== null && input.value !== '' && Number.isFinite(number)) {
          const lower = min === undefined ? -Infinity : Number(min);
          const upper = max === undefined ? Infinity : Number(max);
          const normalized = Math.max(lower, Math.min(upper, number));
          if (normalized !== number) {
            input.value = String(normalized);
            onChange?.(event);
          }
        }
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
