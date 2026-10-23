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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><PhoneModelPicker value={choice} onChange={next => { setChoice(next); onSelect?.(next); setSaved(false); setError(''); }} zh={zh} disabled={disabled || busy} /></div><Button variant="primary" disabled={disabled || busy || !models.data || !ready || choice === value} onClick={() => { void save(); }}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button></div>
    {choice && models.data ? <p className="text-xs text-fg-muted">{selected?.mock ? (zh ? '本地模拟测试，无需 API Key。' : 'Local mock testing. No API key required.') : selected ? `${zh ? '服务商' : 'Provider'}：${providerName} · ${selected.configured ? (zh ? '凭据已配置' : 'Credentials configured') : (zh ? '请先配置凭据' : 'Configure credentials first')}` : (zh ? '当前模型不可用，请重新选择。' : 'This model is unavailable. Choose another model.')}</p> : null}
    <p className="text-xs text-fg-muted">{zh ? '仅显示支持手机操作的模型。' : 'Only Phone Use models are listed.'}<Link to="/settings/capabilities/models" className="ml-1 text-accent-fg hover:underline">{zh ? '前往模型管理添加或配置' : 'Add or configure in Models'}</Link></p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {saved && <p role="status" className="text-xs text-fg-muted">{zh ? '手机模型已保存' : 'Phone model saved'}</p>}
  </div>;
}
