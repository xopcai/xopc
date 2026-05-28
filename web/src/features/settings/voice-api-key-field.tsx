import { Check, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { revealVoiceConfigApiKey } from '@/features/settings/voice-config-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { useMaskedApiKeyField } from '@/lib/use-masked-api-key-field';

export type VoiceApiKeyFieldLabels = {
  maskedHelp: string;
  copy: string;
  copied: string;
  show: string;
  hide: string;
  notInConfigFile: string;
  loadFailed: string;
};

export function VoiceApiKeyField({
  kind,
  providerId,
  fieldId,
  value,
  onChange,
  labels,
  placeholder = 'sk-...',
  className,
}: {
  kind: 'stt' | 'tts';
  providerId: string;
  fieldId: string;
  value: string;
  onChange: (next: string) => void;
  labels: VoiceApiKeyFieldLabels;
  placeholder?: string;
  className?: string;
}) {
  const reveal = useCallback(
    () =>
      revealVoiceConfigApiKey({ kind, provider: providerId }).then((payload) => payload.apiKey ?? null),
    [kind, providerId],
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
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {masked ? <p className="text-xs text-fg-subtle">{labels.maskedHelp}</p> : null}
      <div className="flex flex-wrap gap-2">
        <input
          id={fieldId}
          type={inputType}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-fg',
            'placeholder:text-fg-subtle',
            settingsInputFocusClass,
            'dark:border-edge',
            'min-w-0 flex-1 font-mono text-xs',
          )}
          value={inputValue}
          placeholder={masked ? '••••••••' : placeholder}
          onChange={(e) => onInputChange(e.target.value, onChange)}
        />
        {copyEnabled ? (
          <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void copyKey()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? labels.copied : labels.copy}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="px-2 py-1 text-xs"
          disabled={revealLoading}
          onClick={() => void toggleEye()}
        >
          {revealLoading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : showKey ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
          {showKey ? labels.hide : labels.show}
        </Button>
      </div>
      {masked && showKey && revealed === null && !revealErr ? (
        <p className="text-xs text-amber-700 dark:text-amber-400/90">{labels.notInConfigFile}</p>
      ) : null}
      {revealErr ? <p className="text-xs text-red-600 dark:text-red-400">{revealErr}</p> : null}
    </div>
  );
}
