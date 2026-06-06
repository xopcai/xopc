import { useCallback } from 'react';

import { SecretInput, type SecretInputLabels } from '@/components/ui/secret-input';
import { revealVoiceConfigApiKey } from '@/features/settings/voice-config-api';
import { cn } from '@/lib/cn';

export type VoiceApiKeyFieldLabels = SecretInputLabels & {
  maskedHelp: string;
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

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <SecretInput
        id={fieldId}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        labels={labels}
        reveal={reveal}
        loadFailedLabel={labels.loadFailed}
        maskedHelp={labels.maskedHelp}
        notInConfigFile={labels.notInConfigFile}
        inputClassName="text-xs"
      />
    </div>
  );
}
