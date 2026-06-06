import { useCallback } from 'react';

import { SecretInput, type SecretInputLabels, type SecretInputProps } from '@/components/ui/secret-input';
import { revealProviderApiKey } from '@/features/settings/providers-api';

export type ProviderApiKeyFieldLabels = SecretInputLabels & {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  maskedHelp: string;
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

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {labels.apiKeyLabel}
      </label>
      <SecretInput
        id={inputId}
        value={value}
        onChange={onChange}
        placeholder={labels.apiKeyPlaceholder}
        labels={labels}
        reveal={reveal}
        loadFailedLabel={labels.loadFailed}
        maskedHelp={labels.maskedHelp}
        notInConfigFile={labels.notInConfigFile}
      />
    </div>
  );
}

export type { SecretInputLabels, SecretInputProps };
