import { CheckCircle2, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import type { KeyboardEventHandler, Ref } from 'react';

import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useSecretField } from '@/lib/use-secret-field';

export type SecretInputLabels = {
  show: string;
  hide: string;
  copy: string;
  copied: string;
};

export type SecretInputProps = {
  id?: string;
  name?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  labels: SecretInputLabels;
  reveal?: () => Promise<string | null>;
  loadFailedLabel?: string;
  maskedHelp?: string;
  notInConfigFile?: string;
  /** When equal to `value`, conceal plaintext until show is toggled. */
  baselineValue?: string;
  autoComplete?: string;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  inputRef?: Ref<HTMLInputElement>;
};

const defaultInputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-3 pr-20 font-mono text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
  'dark:border-edge',
);

export function SecretInput({
  id,
  name,
  ariaDescribedBy,
  ariaInvalid,
  value,
  onChange,
  placeholder,
  disabled = false,
  readOnly: readOnlyProp = false,
  className,
  inputClassName,
  labels,
  reveal,
  loadFailedLabel,
  maskedHelp,
  notInConfigFile,
  baselineValue,
  autoComplete = 'off',
  onKeyDown,
  inputRef,
}: SecretInputProps) {
  const {
    masked,
    showKey,
    revealed,
    revealLoading,
    revealErr,
    copied,
    inputValue,
    inputType,
    readOnly: concealedReadOnly,
    copyEnabled,
    copySecret,
    toggleEye,
    onInputChange,
    eyeDisabled,
  } = useSecretField({ value, reveal, loadFailedLabel, baselineValue });

  const readOnly = readOnlyProp || concealedReadOnly;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {masked && maskedHelp ? <p className="text-xs text-fg-subtle">{maskedHelp}</p> : null}
      <div className="relative min-w-0">
        <input
          ref={inputRef}
          id={id}
          name={name}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          type={inputType}
          autoComplete={autoComplete}
          spellCheck={false}
          disabled={disabled}
          readOnly={readOnly}
          value={inputValue}
          placeholder={masked ? undefined : placeholder}
          onChange={onChange ? (e) => onInputChange(e.target.value, onChange) : undefined}
          onKeyDown={onKeyDown}
          className={cn(defaultInputClass, inputClassName)}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
          {copyEnabled ? (
            <button
              type="button"
              className={cn(
                'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg',
                interaction.transition,
                interaction.press,
                interaction.focusRingPanel,
              )}
              title={copied ? labels.copied : labels.copy}
              aria-label={copied ? labels.copied : labels.copy}
              disabled={disabled}
              onClick={() => void copySecret()}
            >
              {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-40',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
            )}
            title={showKey ? labels.hide : labels.show}
            aria-label={showKey ? labels.hide : labels.show}
            disabled={disabled || eyeDisabled}
            onClick={() => void toggleEye()}
          >
            {revealLoading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : showKey ? (
              <EyeOff className="size-3.5" aria-hidden />
            ) : (
              <Eye className="size-3.5" aria-hidden />
            )}
          </button>
        </div>
      </div>
      {masked && showKey && revealed === null && !revealErr && notInConfigFile ? (
        <p className="text-xs text-amber-700 dark:text-amber-400/90">{notInConfigFile}</p>
      ) : null}
      {revealErr ? <p className="text-xs text-red-600 dark:text-red-400">{revealErr}</p> : null}
    </div>
  );
}
