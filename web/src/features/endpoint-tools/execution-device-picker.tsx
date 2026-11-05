import { Monitor } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchManagedDevices, managedDevicesKey } from '@/features/endpoint-tools/management-api';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { ArtifactTransfer } from './artifact-transfer';

type Target = { endpointId: string; principalId: string; connectionId: string; expiresAt: number };

export function ExecutionDevicePicker({ conversationId, disabled }: { conversationId: string | null; disabled: boolean }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const path = conversationId && /^[0-9a-f-]{36}$/i.test(conversationId) ? apiUrl(`/api/endpoint-tools/targets/${encodeURIComponent(conversationId)}`) : null;
  const target = useSWR(path, async url => {
    const response = await apiFetch(url);
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error('Device target unavailable');
    return (await response.json() as { payload: Target }).payload;
  }, { refreshInterval: 5_000, shouldRetryOnError: false });
  const devices = useSWR(path ? managedDevicesKey() : null, fetchManagedDevices, { refreshInterval: 30_000, shouldRetryOnError: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (!path) return null;
  if (target.isLoading || devices.isLoading) return <Skeleton className="mx-2 h-6 w-24 rounded-full" />;
  const options: import('@/components/ui/popover-select').PopoverSelectOption[] = (devices.data ?? []).filter(device => !device.principal?.revokedAt && !device.access?.revokedAt).flatMap(device =>
    device.endpoints.map(endpoint => ({ value: endpoint.endpointId, label: `${device.displayName} · ${device.platform}` })));
  const selected = target.data;
  const device = (devices.data ?? []).find(device => device.id === selected?.principalId);
  const connected = device?.endpoints.some(endpoint => endpoint.endpointId === selected?.endpointId && endpoint.connectionId === selected?.connectionId);
  const unavailable = selected && (!connected || selected.expiresAt <= Date.now());
  const label = selected ? `${device?.displayName ?? (zh ? '所选设备' : 'Selected device')}${unavailable ? (zh ? ' · 需要重新选择' : ' · Reselect required') : ''}` : undefined;
  if (selected && !options.some(option => option.value === selected.endpointId)) options.push({ value: selected.endpointId, label: label!, disabled: true });
  return <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
    <PopoverSelect value={selected?.endpointId ?? ''} options={options} allowEmpty
      emptyLabel={zh ? '由对话选择' : 'Choose in conversation'} placeholder={zh ? '执行设备' : 'Execution device'}
      selectedLabel={label} ariaLabel={zh ? '选择执行设备' : 'Select execution device'}
      triggerIcon={<Monitor className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />}
      triggerClassName="h-8 max-w-36 gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-sm text-fg hover:bg-surface-hover"
      side="top" disabled={disabled || saving || Boolean(devices.error || target.error)}
      onChange={async endpointId => {
        if (saving) return;
        setSaving(true); setError(false);
        try {
          await fetchJson(path, { method: endpointId ? 'PUT' : 'DELETE', ...(endpointId ? { body: JSON.stringify({ endpointId }) } : {}) });
          await target.mutate();
        } catch { setError(true); await target.mutate(); }
        finally { setSaving(false); }
      }} />
    {conversationId && selected && !unavailable && !disabled ? <ArtifactTransfer key={selected.connectionId}
      conversationId={conversationId} deviceName={device?.displayName ?? selected.endpointId} zh={zh} /> : null}
    {error ? <span role="alert" className="text-xs text-danger">{zh ? '无法更改设备，请先结束正在进行的操作并重试。' : 'Unable to change device. Finish active operations and retry.'}</span> : null}
  </span>;
}
