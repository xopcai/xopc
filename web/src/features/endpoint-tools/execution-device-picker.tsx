import { Monitor, Plus } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchManagedDevices, managedDevicesKey } from '@/features/endpoint-tools/management-api';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { ArtifactTransfer } from './artifact-transfer';
import { DevicePairingWizard } from './device-pairing-wizard';

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
  const [pairingOpen, setPairingOpen] = useState(false);
  if (!path) return null;
  const activeDevices = (devices.data ?? []).filter(device => !device.principal?.revokedAt && !device.access?.revokedAt);
  const hasMobile = activeDevices.some(device => device.kind === 'mobile');
  const options: import('@/components/ui/popover-select').PopoverSelectOption[] = activeDevices.flatMap(device =>
    device.endpoints.map(endpoint => ({ value: endpoint.endpointId, label: `${device.displayName} · ${device.platform}` })));
  const selected = target.data;
  const device = (devices.data ?? []).find(device => device.id === selected?.principalId);
  const connected = device?.endpoints.some(endpoint => endpoint.endpointId === selected?.endpointId && endpoint.connectionId === selected?.connectionId);
  const unavailable = selected && (!connected || selected.expiresAt <= Date.now());
  const label = selected ? `${device?.displayName ?? (zh ? '所选设备' : 'Selected device')}${unavailable ? (zh ? ' · 需要重新选择' : ' · Reselect required') : ''}` : undefined;
  if (selected && !options.some(option => option.value === selected.endpointId)) options.push({ value: selected.endpointId, label: label!, disabled: true });
  return <section className="mt-3 space-y-2 border-t border-edge-subtle px-2 pt-3">
    <h3 className="text-sm text-fg-subtle">{zh ? '执行设备' : 'Execution device'}</h3>
    {target.isLoading || devices.isLoading ? <Skeleton className="h-10 w-full rounded-lg" /> : <PopoverSelect value={selected?.endpointId ?? ''} options={options} allowEmpty
      emptyLabel={zh ? '由对话选择' : 'Choose in conversation'} placeholder={zh ? '由对话选择' : 'Choose in conversation'}
      title={label} selectedLabel={label} ariaLabel={zh ? '选择执行设备' : 'Select execution device'}
      triggerIcon={<Monitor className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />}
      triggerClassName="justify-start [&>span]:flex-1"
      side="bottom" disabled={disabled || saving || Boolean(devices.error || target.error)}
      onChange={async endpointId => {
        if (saving) return;
        setSaving(true); setError(false);
        try {
          await fetchJson(path, { method: endpointId ? 'PUT' : 'DELETE', ...(endpointId ? { body: JSON.stringify({ endpointId }) } : {}) });
          await target.mutate();
        } catch { setError(true); await target.mutate(); }
        finally { setSaving(false); }
      }} />}
    {!devices.isLoading && !devices.error && !hasMobile && !disabled ? (
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={() => setPairingOpen(true)}
      >
        <Plus className="size-3.5 shrink-0" aria-hidden />
        <span>{zh ? '连接手机或 Chrome' : 'Connect phone or Chrome'}</span>
      </button>
    ) : null}
    <DevicePairingWizard
      open={pairingOpen}
      onOpenChange={setPairingOpen}
      onPaired={() => void devices.mutate()}
    />
    {conversationId && selected && !unavailable && !disabled ? <ArtifactTransfer key={selected.connectionId}
      conversationId={conversationId} deviceName={device?.displayName ?? selected.endpointId} zh={zh} /> : null}
    {error ? <span role="alert" className="text-xs text-danger">{zh ? '无法更改设备，请先结束正在进行的操作并重试。' : 'Unable to change device. Finish active operations and retry.'}</span> : null}
  </section>;
}
