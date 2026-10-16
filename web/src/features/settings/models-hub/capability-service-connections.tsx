import type { ModelSetupPreview, ModelSetupUse } from '@xopcai/gateway-contract';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { modelsJsonPresetKeyForProviderId } from '@/features/settings/models/models-settings-lib';
import { fetchVoiceProviders, fetchVoiceSttProviders } from '@/features/settings/voice-config-api';
import type { StoredLanguage } from '@/lib/storage';

import { AddProviderDialog, type AddProviderDialogMessages } from './add-provider-dialog';
import { capabilityLabels } from './capability-navigation';
import type { ConnectedProvidersData } from './connected-providers-grid';
import { fetchModelSetup } from './provider-setup-api';

/** Native speech APIs have separate credentials from similarly named LLM providers. */
export function eligibleCapabilityServices(previews: ModelSetupPreview[], use: ModelSetupUse, nativeIds: string[] = []) {
  return previews.filter(preview => !nativeIds.includes(preview.providerId)
    && preview.uses.some(entry => entry.id === use && entry.choices.length > 0));
}

export function CapabilityServiceConnections({ use, data, language, labels, onSaved }: {
  use: ModelSetupUse; data: ConnectedProvidersData; language: StoredLanguage;
  labels: AddProviderDialogMessages; onSaved: () => void;
}) {
  const zh = language === 'zh';
  const [provider, setProvider] = useState<string>();
  const voiceKind = use === 'transcription' ? 'stt' : use === 'speech' ? 'tts' : undefined;
  const configuredIds = new Set(data.cards.map(card => card.id));
  const ids = [...new Set([...data.builtinRows.map(row => row.id), ...configuredIds])]
    .filter(id => !modelsJsonPresetKeyForProviderId(id) || configuredIds.has(id)).sort();
  const { data: catalog, error, isLoading, mutate } = useSWR(data.loading ? null : ['capability-service-connections', use, ids.join(',')], async () => {
    const native = voiceKind === 'stt' ? await fetchVoiceSttProviders() : voiceKind === 'tts' ? await fetchVoiceProviders() : undefined;
    const sharedIds = native?.providers.filter(entry => !entry.diagnostics.requiresApiKey).map(entry => entry.id);
    const nativeIds = native?.providers.filter(entry => entry.diagnostics.requiresApiKey).map(entry => entry.id) ?? [];
    const candidates = sharedIds ? ids.filter(id => sharedIds.includes(id)) : ids;
    const results = await Promise.allSettled(candidates.map(fetchModelSetup));
    const previews = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    return { services: eligibleCapabilityServices(previews, use, nativeIds), failed: results.some(result => result.status === 'rejected') };
  }, { revalidateOnFocus: false });
  const eligibleIds = new Set(catalog?.services.map(service => service.providerId));
  return <section className="space-y-3 rounded-xl border border-edge p-4">
    <h2 className="text-sm font-semibold text-fg">{zh ? '支持此能力的模型服务' : 'Model services supporting this capability'}</h2>
    {data.loading || isLoading ? <Skeleton className="h-24 w-full" /> : null}
    {error || catalog?.failed ? <p role="alert" className="text-sm text-fg-muted">{zh ? '部分服务目录暂时不可用。' : 'Some service catalogs are unavailable.'}<Button variant="ghost" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></p> : null}
    {catalog?.services.map(service => <button key={service.providerId} type="button" onClick={() => setProvider(service.providerId)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-edge px-3 py-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <span className="min-w-0 text-sm font-medium text-fg">{service.profile.name}</span>
      <span className="shrink-0 text-xs text-accent-fg">{service.configured ? (zh ? '已连接 · 管理凭据' : 'Connected · Credentials') : (zh ? '连接' : 'Connect')}</span>
    </button>)}
    {catalog && !catalog.services.length && !catalog.failed ? <p className="text-sm text-fg-muted">{zh ? '暂无支持此能力的模型服务。' : 'No model services currently support this capability.'}</p> : null}
    <p className="text-xs text-fg-muted">{zh ? `仅展示支持“${capabilityLabels[use][0]}”的服务。已有凭据可直接复用；连接后返回选择模型。` : 'Only compatible services are shown. Reuse saved credentials, then return to select a model.'}</p>
    {provider ? <AddProviderDialog key={provider} open initialProviderId={provider} initialUse={use} connectOnly onOpenChange={open => { if (!open) setProvider(undefined); }} builtinRows={data.builtinRows.filter(row => eligibleIds.has(row.id))} customConfig={data.customConfig} labels={labels} language={language} onSaved={() => { void mutate(); setProvider(undefined); onSaved(); }} /> : null}
  </section>;
}
