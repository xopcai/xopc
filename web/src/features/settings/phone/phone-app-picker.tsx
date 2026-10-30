import { AppWindow, RefreshCw, Search } from 'lucide-react';
import { useId, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { fetchPhoneApplications } from './phone-api';

export function PhoneAppPicker({ deviceId, serial, platform, mode, selected, onModeChange, onSelectedChange, disabled, zh }: {
  deviceId?: string; serial: string; platform?: 'android' | 'harmonyos'; mode: 'all' | 'selected'; selected: string[]; disabled?: boolean; zh: boolean;
  onModeChange(mode: 'all' | 'selected'): void; onSelectedChange(apps: string[]): void;
}) {
  const group = useId(); const [query, setQuery] = useState('');
  const apps = useSWR(mode === 'selected' ? ['phone-applications', deviceId ?? serial, platform ?? 'android'] : null,
    () => fetchPhoneApplications(deviceId, serial, platform), { revalidateOnFocus: false, shouldRetryOnError: false });
  const search = query.trim().toLocaleLowerCase();
  const choices = apps.data?.filter(app => `${app.label} ${app.packageName}`.toLocaleLowerCase().includes(search)) ?? [];
  const catalog = apps.data;
  const missing = catalog ? selected.filter(pkg => !catalog.some(app => app.packageName === pkg)) : [];
  const toggle = (pkg: string) => onSelectedChange(selected.includes(pkg) ? selected.filter(value => value !== pkg) : [...selected, pkg]);
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-2 text-sm font-medium">{zh ? '应用权限' : 'Application access'}</legend>
    <div className="grid gap-2">
      {(['all', 'selected'] as const).map(value => <label key={value} className={cn('flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3', mode === value ? 'border-accent/50 bg-accent-soft' : 'border-edge bg-surface-base')}>
        <input type="radio" name={group} value={value} checked={mode === value} onChange={() => onModeChange(value)} className="mt-1 size-4 shrink-0 accent-accent" />
        <span className="min-w-0"><span className="block text-sm font-medium">{value === 'all' ? (zh ? '允许所有应用' : 'Allow all apps') : (zh ? '仅允许所选应用' : 'Only selected apps')}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{value === 'all' ? (zh ? '可在手机上的应用间切换，无需逐个配置。' : 'Switch between apps on this phone without individual setup.') : (zh ? '从手机上已安装的应用中选择。' : 'Choose from applications installed on the phone.')}</span></span>
      </label>)}
    </div>
    {mode === 'selected' ? <div className="space-y-2" aria-label={zh ? '选择手机应用' : 'Choose phone applications'}>
      <div className="flex items-center justify-between gap-2"><p role="status" className="text-xs text-fg-muted">{zh ? `已选择 ${selected.length} 个应用` : `${selected.length} apps selected`}</p>
        <Button variant="ghost" className="gap-1 px-2 py-1 text-xs" aria-label={zh ? '刷新应用列表' : 'Refresh applications'} disabled={disabled || apps.isValidating} onClick={() => { void apps.mutate(); }}><RefreshCw className={cn('size-3.5', apps.isValidating && 'animate-spin motion-reduce:animate-none')} aria-hidden />{zh ? '刷新' : 'Refresh'}</Button></div>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-fg-muted" aria-hidden /><input type="search" aria-label={zh ? '搜索手机应用' : 'Search phone applications'} placeholder={zh ? '搜索应用' : 'Search apps'} value={query} onChange={event => setQuery(event.target.value)} className="min-h-10 w-full rounded-lg border border-edge bg-surface-base py-2 pl-9 pr-3 text-sm focus-visible:outline-2 focus-visible:outline-accent" /></div>
      {apps.error ? <div role="alert" className="rounded-lg bg-surface-inset p-3 text-sm text-fg-muted">{zh ? '暂时无法读取应用，请确认手机已连接后重试。之前的选择会保留。' : 'Unable to read apps. Check the phone connection and retry. Previous selections are preserved.'}<Button variant="ghost" className="ml-1 text-accent" onClick={() => { void apps.mutate(); }}>{zh ? '重试' : 'Retry'}</Button></div> : null}
      {!apps.data && !apps.error ? <div aria-busy="true" className="space-y-2 rounded-lg border border-edge p-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : apps.data ? <div className="max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-edge bg-surface-base" aria-label={zh ? '可选应用' : 'Available applications'}>
        {choices.map(app => <label key={app.packageName} className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-hover">
          <AppWindow className="size-5 shrink-0 text-fg-muted" aria-hidden /><span className="min-w-0 flex-1"><span className="block truncate text-sm" title={app.label}>{app.label}</span>{app.label !== app.packageName && apps.data!.some(other => other.packageName !== app.packageName && other.label === app.label) ? <span className="block truncate text-xs text-fg-muted">{app.packageName}</span> : null}</span>
          <input type="checkbox" aria-label={app.label} checked={selected.includes(app.packageName)} onChange={() => toggle(app.packageName)} className="size-4 shrink-0 accent-accent" />
        </label>)}
        {!choices.length ? <p className="p-4 text-center text-sm text-fg-muted">{search ? (zh ? '没有找到匹配的应用' : 'No matching applications') : (zh ? '这台手机上没有可打开的应用' : 'No launchable applications on this phone')}</p> : null}
      </div> : null}
      {missing.length ? <div className="space-y-1 text-xs text-fg-muted"><p>{zh ? '以下原有选择未在手机上找到，可取消选择。' : 'These previous selections are no longer available. You may deselect them.'}</p>{missing.map(pkg => <label key={pkg} className="flex min-h-9 items-center gap-2"><input type="checkbox" checked onChange={() => toggle(pkg)} className="accent-accent" /><span className="break-all">{pkg}</span></label>)}</div> : null}
      {!selected.length ? <p className="text-xs text-fg-muted">{zh ? '至少选择一个应用后保存。' : 'Choose at least one application before saving.'}</p> : null}
    </div> : null}
  </fieldset>;
}
