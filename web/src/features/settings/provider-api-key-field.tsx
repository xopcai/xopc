import { CheckCircle2, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback } from 'react';

import { revealProviderApiKey } from '@/features/settings/providers-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useMaskedApiKeyField } from '@/lib/use-masked-api-key-field';

export type ProviderApiKeyFieldLabels = {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  maskedHelp: string;
  copy: string;
  copied: string;
  show: string;
  hide: string;
  notInConfigFile: string;
  loadFailed: string;
};

export function ProviderApiKeyField({
  providerId,
  inputId,
  value,
  onChange,
  labels,
}: {
  providerId: string;
  inputId: string;
  value: string;
  onChange: (next: string) => void;
  labels: ProviderApiKeyFieldLabels;
}) {
  const reveal = useCallback(
    () => revealProviderApiKey(providerId).then((payload) => payload.apiKey ?? null),
    [providerId],
  );

  const {
    masked,
    showKey,
    revealed,
    revealLoading,
    revealErr,
    copied,
    inputValue,
    inputType,
    copyEnabled,
    copyKey,
    toggleEye,
    onInputChange,
  } = useMaskedApiKeyField({ value, reveal, loadFailedLabel: labels.loadFailed });

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {labels.apiKeyLabel}
      </label>
      {masked ? <p className="text-xs text-fg-subtle">{labels.maskedHelp}</p> : null}
      <div className="relative">
        <input
          id={inputId}
          type={inputType}
          autoComplete="off"
          spellCheck={false}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value, onChange)}
          placeholder={masked ? undefined : labels.apiKeyPlaceholder}
          className={cn(
            'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-3 pr-20 font-mono text-sm text-fg placeholder:text-fg-subtle',
            settingsInputFocusClass,
          )}
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
              onClick={() => void copyKey()}
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
            disabled={revealLoading || (!masked && !value.trim())}
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
      {masked && showKey && revealed === null && !revealErr ? (
        <p className="text-xs text-amber-700 dark:text-amber-400/90">{labels.notInConfigFile}</p>
      ) : null}
      {revealErr ? <p className="text-xs text-red-600 dark:text-red-400">{revealErr}</p> : null}
    </div>
  );
}
