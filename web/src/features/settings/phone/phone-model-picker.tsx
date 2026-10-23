import useSWR from 'swr';

import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchPhoneModels } from './phone-api';

export function PhoneModelPicker({ value, onChange, zh, disabled = false }: { value: string; onChange(value: string): void; zh: boolean; disabled?: boolean }) {
  const models = useSWR('phone-models', fetchPhoneModels);
  if (!models.data && !models.error) return <Skeleton className="h-11 w-full rounded-lg" />;
  return <div className="space-y-2">
    <Select aria-label={zh ? '手机模型' : 'Phone model'} value={value} disabled={disabled || Boolean(models.error)} onChange={event => onChange(event.target.value)}>
      <SelectOption value="">{zh ? '未配置' : 'Not configured'}</SelectOption>
      {value && !models.data?.models.some(model => model.id === value) && <SelectOption value={value}>{value}</SelectOption>}
      {models.data?.models.map(model => <SelectOption key={model.id} value={model.id}>{model.mock ? (zh ? '模拟模型 · 系统设置测试' : 'Mock · Android Settings test') : `${model.name} · ${model.id.split('/')[0]}${model.configured ? '' : zh ? ' · 待配置凭据' : ' · Credentials needed'}`}</SelectOption>)}
    </Select>
    {models.error && <p role="alert" className="text-sm text-danger">{String(models.error)}</p>}
  </div>;
}

export function PhoneModelOverride({ value, inherited, onChange, zh }: {
  value: { primary: string; fallbacks: string[] } | null | undefined;
  inherited?: { primary: string }; onChange(value: { primary: string; fallbacks: string[] } | undefined): void; zh: boolean;
}) {
  return <section className="space-y-3 rounded-2xl border border-edge bg-surface-base p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h4 className="text-sm font-medium text-fg">{zh ? '手机操作模型' : 'Phone Use model'}</h4>
        <p className="mt-1 break-all text-xs text-fg-muted">{value ? value.primary : `${zh ? '继承全局' : 'Inherited'}: ${inherited?.primary ?? '—'}`}</p></div>
      <button type="button" className="touch-target rounded-lg px-3 py-2 text-sm text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onChange(value ? undefined : { primary: inherited?.primary ?? '', fallbacks: [] })}>{value ? (zh ? '继承全局' : 'Inherit globally') : (zh ? '单独设置' : 'Override')}</button>
    </div>
    {value && <PhoneModelPicker value={value.primary} onChange={primary => onChange({ primary, fallbacks: [] })} zh={zh} />}
  </section>;
}
