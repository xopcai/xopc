import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchVoiceProviders, fetchVoiceSttProviders, type VoiceConfigFieldMetadata } from '@/features/settings/voice-config-api';
import { fetchJson } from '@/lib/fetch';
import { DEFAULT_SECRET_INPUT_LABELS } from '@/lib/secret-input-labels';
import { apiUrl } from '@/lib/url';
import { revalidateModelsHubCaches } from './models-hub-cache';

/** Preserve the native STT/TTS credential domains; connecting never assigns a route. */
export function MediaServiceConnections({ zh, kind, modelServiceIds, onSaved, onPendingChange }: { zh: boolean; kind?: 'stt' | 'tts'; modelServiceIds: string[]; onSaved: () => void; onPendingChange?: (pending: boolean) => void }) {
  const { data, error, mutate } = useSWR(['native-voice-connections', kind ?? 'all', modelServiceIds.join(',')], async () => {
    const [stt, tts] = await Promise.all([kind === 'tts' ? Promise.resolve({ providers: [] }) : fetchVoiceSttProviders(), kind === 'stt' ? Promise.resolve({ providers: [] }) : fetchVoiceProviders()]);
    return [...stt.providers.map(entry => ({ ...entry, kind: 'stt' as const })), ...tts.providers.map(entry => ({ ...entry, kind: 'tts' as const }))]
      .filter(entry => entry.diagnostics.requiresApiKey || !modelServiceIds.includes(entry.id));
  });
  const [selected, setSelected] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [failure, setFailure] = useState('');
  useEffect(() => { onPendingChange?.(busy); return () => onPendingChange?.(false); }, [busy, onPendingChange]);
  const entry = data?.find(entry => `${entry.kind}:${entry.id}` === selected);
  const connectionFields = entry?.fields.filter(field => field.secret || field.type === 'password' || ['baseUrl', 'region', 'groupId'].includes(field.key)) ?? [];
  const save = async () => {
    if (!entry || saving.current) return;
    saving.current = true;
    setBusy(true); setFailure('');
    try {
      const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]));
      if (Object.keys(patch).length) await fetchJson(apiUrl('/api/config'), { method: 'PATCH', body: JSON.stringify({ [entry.kind]: { providers: { [entry.id]: patch } } }) });
      const [fresh] = await Promise.all([mutate(), revalidateModelsHubCaches()]);
      if (!fresh?.find(source => source.kind === entry.kind && source.id === entry.id)?.configured) throw new Error(zh ? '连接尚未就绪，请补齐所需凭据。' : 'Connection is not ready. Complete the required credentials.');
      setFields({}); onSaved();
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); }
    finally { saving.current = false; setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border border-edge p-4">
    <h2 className="text-sm font-semibold text-fg">{kind === 'stt' ? (zh ? '其他识别服务' : 'Other recognition services') : kind === 'tts' ? (zh ? '其他合成服务与本地语音' : 'Other synthesis services and local speech') : (zh ? '语音 API 与本地语音' : 'Voice APIs and local speech')}</h2>
    {!data && !error ? <Skeleton className="h-20 w-full" /> : null}
    {error ? <p role="alert">{zh ? '语音服务加载失败' : 'Could not load voice services'}<Button variant="ghost" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></p> : null}
    <Select value={selected} disabled={busy} aria-label={zh ? '语音服务接入' : 'Connect voice service'} onChange={event => { setSelected(event.target.value); setFields({}); setFailure(''); }}>
      <SelectOption value="">{zh ? '选择语音来源' : 'Choose a voice source'}</SelectOption>
      {data?.map(entry => <SelectOption key={`${entry.kind}:${entry.id}`} value={`${entry.kind}:${entry.id}`}>{entry.displayName} · {entry.kind.toUpperCase()}{entry.configured ? (zh ? ' · 已连接' : ' · Connected') : ''}</SelectOption>)}
    </Select>
    {entry ? <>
      <p className="text-xs text-fg-muted">{entry.diagnostics.requiresApiKey ? (zh ? '凭据按语音用途独立保存；留空保留现有值。连接不会启用或切换模型。' : 'Voice credentials are stored independently. Leave empty to preserve existing values. Connecting does not change models.') : (zh ? '此来源无需 API Key，可返回能力设置选择。' : 'No API key needed. Choose this source in capability settings.')}</p>
      {connectionFields.map((field: VoiceConfigFieldMetadata) => <label key={field.key} className="block space-y-1 text-sm text-fg"><span>{field.label}</span>
        {field.secret || field.type === 'password' ? <SecretInput labels={DEFAULT_SECRET_INPUT_LABELS} value={fields[field.key] ?? ''} onChange={value => setFields(current => ({ ...current, [field.key]: value }))} disabled={busy} /> : field.options?.length ? <Select value={fields[field.key] ?? ''} disabled={busy} onChange={event => setFields(current => ({ ...current, [field.key]: event.target.value }))}><SelectOption value="">{zh ? '保留现有值' : 'Keep existing'}</SelectOption>{field.options.map(option => <SelectOption key={option.id} value={option.id}>{option.name}</SelectOption>)}</Select> : <input className="w-full rounded-lg border border-edge bg-surface-panel p-2" value={fields[field.key] ?? ''} disabled={busy} placeholder={field.placeholder} onChange={event => setFields(current => ({ ...current, [field.key]: event.target.value }))} />}
      </label>)}
      {failure ? <p role="alert" className="text-sm text-danger">{failure}</p> : null}
      <Button disabled={busy || (!entry.configured && entry.diagnostics.requiresApiKey && !Object.values(fields).some(value => value.trim()))} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存连接' : 'Save connection')}</Button>
    </> : null}
  </section>;
}
