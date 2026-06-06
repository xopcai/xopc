import { ExternalLink } from 'lucide-react';
import { useCallback } from 'react';

import { SecretInput, type SecretInputLabels } from '@/components/ui/secret-input';
import { revealImageProviderConfigApiKey } from '@/features/settings/image-providers-config-api';
import type { ApiKeyLinkKind } from '@/features/settings/provider-enrichment';
import { providerApiKeyLinkLabel } from '@/features/settings/provider-enrichment';
import type { ProvidersSettingsMessages } from '@/i18n/messages';

export type ImageProviderApiKeyFieldLabels = SecretInputLabels & {
  apiKeyLabel: string;
  optionalPlaceholder: string;
  maskedHelp: string;
  notInConfigFile: string;
  loadFailed: string;
};

export function ImageProviderApiKeyField({
  providerId,
  value,
  onChange,
  labels,
  apiKeyLinks,
  apiKeyLinkLabels,
}: {
  providerId: string;
  value: string;
  onChange: (next: string) => void;
  labels: ImageProviderApiKeyFieldLabels;
  apiKeyLinks: { href: string; kind: ApiKeyLinkKind }[];
  apiKeyLinkLabels: Pick<ProvidersSettingsMessages, 'getApiKey' | 'getApiKeyIntl' | 'getApiKeyCn'>;
}) {
  const reveal = useCallback(
    () => revealImageProviderConfigApiKey(providerId).then((payload) => payload.apiKey ?? null),
    [providerId],
  );

  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
      <label className="text-xs font-medium text-fg-muted" htmlFor={`img-cred-key-${providerId}`}>
        {labels.apiKeyLabel}
      </label>
      {apiKeyLinks.length > 0 ? (
        <div className="flex flex-col gap-1">
          {apiKeyLinks.map((link) => (
            <a
              key={`${link.kind}-${link.href}`}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {providerApiKeyLinkLabel(link.kind, apiKeyLinkLabels)}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
        </div>
      ) : null}
      <SecretInput
        id={`img-cred-key-${providerId}`}
        value={value}
        onChange={onChange}
        placeholder={labels.optionalPlaceholder}
        labels={labels}
        reveal={reveal}
        loadFailedLabel={labels.loadFailed}
        maskedHelp={labels.maskedHelp}
        notInConfigFile={labels.notInConfigFile}
      />
    </div>
  );
}
