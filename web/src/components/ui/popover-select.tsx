import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Children, Fragment, isValidElement, useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { settingsShellPopoverZClass } from '@/lib/settings-shell-layer.utils';
import {
  useSettingsShellPopoverLayer,
  useSettingsShellPopoverPortalContainer,
} from '@/lib/settings-shell-layer-context';

export type PopoverSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
};

export type SelectChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'multiple' | 'onChange' | 'size'> & {
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
  contentClassName?: string;
  onChange?: (event: SelectChangeEvent) => void;
  placeholder?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  triggerClassName?: string;
};

export type SelectOptionProps = {
  children?: ReactNode;
  disabled?: boolean;
  value?: string | number;
};

export type SelectGroupProps = {
  children?: ReactNode;
  label?: ReactNode;
};

export function PopoverSelect({
  value,
  options,
  placeholder,
  allowEmpty = true,
  emptyLabel = placeholder,
  emptyDisabled = false,
  disabledValues,
  disabled,
  id,
  ariaLabel,
  ariaLabelledBy,
  title,
  triggerClassName,
  contentClassName,
  side = 'bottom',
  align = 'start',
  onChange,
}: {
  value: string;
  options: PopoverSelectOption[];
  placeholder: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  emptyDisabled?: boolean;
  disabledValues?: Set<string>;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  title?: string;
  triggerClassName?: string;
  contentClassName?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const settingsShellLayer = useSettingsShellPopoverLayer();
  const portalContainer = useSettingsShellPopoverPortalContainer();
  const popoverZ = settingsShellPopoverZClass(settingsShellLayer, portalContainer !== null);
  const selected = options.find((option) => option.value === value);
  const label = selected?.label ?? (value ? `${value} · unavailable` : placeholder);
  let lastGroup: string | undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          title={title}
          disabled={disabled}
          className={cn(
            'box-border flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-edge bg-surface-subtle px-3 text-left text-sm font-normal text-fg',
            'hover:border-edge-strong focus-visible:outline-none focus-visible:border-edge-strong',
            disabled && 'cursor-not-allowed opacity-50 hover:border-edge',
            triggerClassName,
          )}
        >
          <span className={cn('min-w-0 truncate', !value && 'text-fg-subtle')}>{label}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={4}
          className={cn(
            popoverZ,
            'w-[var(--radix-popover-trigger-width)] min-w-[16rem] overflow-hidden rounded-lg border border-edge bg-surface-panel p-1 shadow-popover outline-none',
            contentClassName,
          )}
        >
          <div className="max-h-64 overflow-y-auto">
            {allowEmpty ? (
              <button
                type="button"
                disabled={emptyDisabled}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-surface-hover',
                  value === '' && 'bg-surface-active font-medium',
                  emptyDisabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
                )}
                onClick={() => {
                  if (emptyDisabled) return;
                  onChange('');
                  setOpen(false);
                }}
              >
                <Check className={cn('size-4 shrink-0', value !== '' && 'invisible')} aria-hidden="true" />
                <span className="min-w-0 truncate text-fg-subtle">{emptyLabel}</span>
              </button>
            ) : null}
            {options.map((option) => {
              const disabled =
                option.disabled === true || (disabledValues?.has(option.value) === true && option.value !== value);
              const showGroup = option.group && option.group !== lastGroup;
              lastGroup = option.group;
              return (
                <Fragment key={`${option.group ?? ''}:${option.value}`}>
                  {showGroup ? (
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                      {option.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                      'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-surface-hover',
                      option.value === value && 'bg-surface-active font-medium',
                      disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
                    )}
                    onClick={() => {
                      if (disabled) return;
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn('size-4 shrink-0', option.value !== value && 'invisible')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                </Fragment>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return '';
}

function optionsFromChildren(children: ReactNode, group?: string): PopoverSelectOption[] {
  const options: PopoverSelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      options.push(...optionsFromChildren((child.props as { children?: ReactNode }).children, group));
      return;
    }
    if (child.type === SelectGroup) {
      const props = child.props as SelectGroupProps;
      options.push(...optionsFromChildren(props.children, textFromNode(props.label)));
      return;
    }
    if (child.type !== SelectOption) return;

    const props = child.props as SelectOptionProps;
    const label = textFromNode(props.children).trim();
    const value = props.value == null ? label : String(props.value);
    options.push({ value, label, disabled: props.disabled, group });
  });
  return options;
}

export function SelectOption(_props: SelectOptionProps) {
  return null;
}

export function SelectGroup(_props: SelectGroupProps) {
  return null;
}

function selectWrapperClassName(className?: string) {
  if (!className) return undefined;
  const layoutTokens = className
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const base = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
      return (
        base === 'block' ||
        base === 'inline-block' ||
        base === 'inline-flex' ||
        base === 'flex' ||
        base === 'flex-1' ||
        base === 'flex-auto' ||
        base === 'flex-initial' ||
        base === 'flex-none' ||
        base === 'grow' ||
        base === 'shrink' ||
        base === 'min-w-0' ||
        base === 'min-h-0' ||
        base.startsWith('w-') ||
        base.startsWith('min-w-') ||
        base.startsWith('max-w-') ||
        base.startsWith('basis-') ||
        base.startsWith('grow-') ||
        base.startsWith('shrink-') ||
        base.startsWith('self-') ||
        base.startsWith('order-') ||
        base.startsWith('col-') ||
        base.startsWith('row-')
      );
    });
  return layoutTokens.length === 0 ? undefined : layoutTokens.join(' ');
}

export function Select({
  align,
  children,
  className,
  contentClassName,
  disabled,
  id,
  onChange,
  placeholder,
  side,
  triggerClassName,
  value,
  ...rest
}: SelectProps) {
  const fallbackId = useId();
  const stringValue = value == null ? '' : String(value);
  const options = optionsFromChildren(children);
  const firstEmptyOption = options.find((option) => option.value === '');
  const allowEmpty = firstEmptyOption !== undefined;
  const emptyLabel = firstEmptyOption?.label || placeholder || '';

  return (
    <div aria-disabled={disabled || undefined} className={selectWrapperClassName(className)} data-select-name={rest.name}>
      <PopoverSelect
        id={id ?? fallbackId}
        value={stringValue}
        options={options.filter((option) => option.value !== '')}
        placeholder={placeholder ?? emptyLabel}
        allowEmpty={allowEmpty}
        emptyLabel={emptyLabel}
        emptyDisabled={firstEmptyOption?.disabled === true}
        disabled={disabled}
        ariaLabel={rest['aria-label']}
        ariaLabelledBy={rest['aria-labelledby']}
        title={rest.title}
        side={side}
        align={align}
        triggerClassName={cn(className, triggerClassName)}
        contentClassName={contentClassName}
        onChange={(nextValue) => onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } })}
      />
      <input name={rest.name} value={stringValue} readOnly hidden disabled={disabled} />
    </div>
  );
}
