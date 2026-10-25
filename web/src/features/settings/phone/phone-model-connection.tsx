import { openCapabilitySettings } from '@/features/settings/models-hub/open-capability-settings';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { fetchProviderMetaList } from '@/features/settings/providers-api';

import { fetchPhoneModels } from './phone-api';
import { PhoneModelPicker } from './phone-model-picker';

/** Selects the dedicated phone route; provider connections are managed centrally. */
export function PhoneModelConnection({ value, zh, disabled, onSave, onSelect }: {
  value: string; zh: boolean; disabled: boolean; onSave(modelRef: string): Promise<void>; onSelect?(modelRef: string): void;
}) {
  const models = useSWR('phone-models', fetchPhoneModels);
  const providers = useSWR('phone-provider-meta', fetchProviderMetaList);
  const [choice, setChoice] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setChoice(value); }, [value]);
  const selected = models.data?.models.find(model => model.id === choice);
  const providerId = choice.split('/')[0];
  const providerName = providers.data?.find(provider => provider.id === providerId)?.name ?? providerId;
  const ready = !choice || Boolean(selected?.configured);
  const save = async () => {
    if (busy || !ready) return;
    setBusy(true); setError(''); setSaved(false);
    try { await onSave(choice); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><PhoneModelPicker value={choice} onChange={next => { setChoice(next); onSelect?.(next); setSaved(false); setError(''); }} zh={zh} disabled={disabled || busy} /></div><Button variant={choice === value ? 'secondary' : 'primary'} disabled={disabled || busy || !models.data || !ready || choice === value} onClick={() => { void save(); }}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button></div>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    {choice && models.data ? <p className="text-xs text-fg-muted">{selected ? `${providerName} · ${selected.configured ? (zh ? '凭据就绪' : 'Credentials ready') : (zh ? '请先配置凭据' : 'Configure credentials first')}` : (zh ? '当前模型不可用，请重新选择。' : 'This model is unavailable. Choose another model.')}</p> : null}

    <Link to="/settings/capabilities/models?returnTo=%2Fsettings%2Fphone-use&purpose=phone" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); openCapabilitySettings('chat', 'services', 'phone'); } }} className="inline-flex min-h-8 items-center text-xs text-accent-fg hover:underline">{zh ? '管理模型' : 'Manage models'}</Link>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {saved && <p role="status" className="text-xs text-fg-muted">{zh ? '手机模型已保存，请返回手机连接测试实际操作。' : 'Phone model saved. Test it from the phone connection.'}</p>}
  </div>;
}
