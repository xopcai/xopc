import { Cloud, LoaderCircle, Plug } from 'lucide-react';
import { useCallback, useState } from 'react';

import { SecretInput } from '@/components/ui/secret-input';
import { revealBrowserCloudApiKey } from '@/features/settings/gateway-config-api';
import { messages } from '@/i18n/messages';
import { secretInputLabelsFromChannels } from '@/lib/secret-input-labels';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsField } from '../../agent-defaults-field';
import { inputClassName, selectClassName } from '../../defaults-field-styles';

import { ActionResultBox, BackendModeCard } from './backend-mode-card';
import type { BrowserMessages } from './types';

type ActionStatus = 'idle' | 'pending' | 'ok' | 'error';

export interface CloudCardForm {
  provider: 'local' | 'browserbase' | 'browser-use';
  apiKey: string;
  projectId: string;
  region: string;
}

export function CloudCard({
  m,
  form,
  onChange,
  testCloud,
  embedded = false,
}: {
  m: BrowserMessages;
  form: CloudCardForm;
  onChange: (patch: Partial<CloudCardForm>) => void;
  testCloud: (provider: 'browserbase' | 'browser-use', apiKey: string) => Promise<{ reachable: boolean; error?: string }>;
  embedded?: boolean;
}) {
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const provider = form.provider === 'local' ? 'browserbase' : form.provider;

  const language = useLocaleStore((s) => s.language);
  const ps = messages(language).providersSettings;
  const secretLabels = secretInputLabelsFromChannels({
    show: ps.show,
    hide: ps.hide,
    copy: ps.copy,
    copied: ps.copied,
  });

  const reveal = useCallback(() => revealBrowserCloudApiKey().then((payload) => payload.apiKey ?? null), []);

  const onTest = useCallback(async () => {
    setStatus('pending');
    setMessage(null);
    try {
      const result = await testCloud(provider, form.apiKey);
      if (result.reachable) {
        setStatus('ok');
        setMessage(m.browserCloudTestOk);
      } else {
        setStatus('error');
        setMessage(m.browserCloudTestFailed.replace('{{error}}', result.error ?? '—'));
      }
    } catch (e) {
      setStatus('error');
      setMessage(m.browserCloudTestFailed.replace('{{error}}', e instanceof Error ? e.message : String(e)));
    }
  }, [form.apiKey, m.browserCloudTestFailed, m.browserCloudTestOk, provider, testCloud]);

  return (
    <BackendModeCard
      icon={Cloud}
      title={m.label.browserCloudProvider}
      description={m.desc.browserCloudProvider}
      m={m}
      embedded={embedded}
      primaryAction={
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status === 'pending'}
          onClick={() => void onTest()}
        >
          {status === 'pending' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
          {m.browserCloudTestConnection}
        </button>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <AgentDefaultsField label={m.label.browserCloudProvider} description={m.desc.browserCloudProvider}>
          <select
            className={selectClassName()}
            value={provider}
            onChange={(e) => onChange({ provider: e.target.value as CloudCardForm['provider'] })}
          >
            <option value="browserbase">{m.browserCloudProviderBrowserbase}</option>
            <option value="browser-use">{m.browserCloudProviderBrowserUse}</option>
          </select>
        </AgentDefaultsField>
        <AgentDefaultsField label={m.label.browserCloudApiKey} description={m.desc.browserCloudApiKey}>
          <SecretInput
            value={form.apiKey}
            onChange={(apiKey) => onChange({ apiKey })}
            placeholder={provider === 'browserbase' ? 'BROWSERBASE_API_KEY' : 'BROWSER_USE_API_KEY'}
            labels={secretLabels}
            reveal={reveal}
            loadFailedLabel="Failed to load key"
          />
        </AgentDefaultsField>
        {provider === 'browserbase' ? (
          <AgentDefaultsField label={m.label.browserCloudProjectId} description={m.desc.browserCloudProjectId}>
            <input
              type="text"
              className={inputClassName()}
              value={form.projectId}
              placeholder="BROWSERBASE_PROJECT_ID"
              onChange={(e) => onChange({ projectId: e.target.value })}
              autoComplete="off"
            />
          </AgentDefaultsField>
        ) : null}
        <AgentDefaultsField label={m.label.browserCloudRegion} description={m.desc.browserCloudRegion}>
          <input
            type="text"
            className={inputClassName()}
            value={form.region}
            placeholder="us-west-2"
            onChange={(e) => onChange({ region: e.target.value })}
            autoComplete="off"
          />
        </AgentDefaultsField>
      </div>
      {message ? (
        <ActionResultBox kind={status === 'error' ? 'error' : 'success'} message={message} />
      ) : null}
    </BackendModeCard>
  );
}
