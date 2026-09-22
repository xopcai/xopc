import { Activity, ChevronLeft, ChevronRight, Laptop, MonitorSmartphone, Search, ShieldOff, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageTabs } from '@/components/ui/page-tabs';
import { PopoverSelect } from '@/components/ui/popover-select';
import { RefreshButton } from '@/components/ui/refresh-button';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsPageFrame, SettingsPageHeader, SettingsTabPanel } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { DeviceDetailDrawer } from './device-detail-drawer';
import { DevicePairingAction } from './device-pairing-action';
import {
  endpointInvocationsKey,
  fetchEndpointInvocations,
  fetchManagedDevices,
  managedDevicesKey,
  revokeManagedDevices,
  type InvocationFilters,
  type ManagedDevice,
} from './management-api';
import {
  filterManagedDevices,
  isManagedDeviceStale,
  managedDeviceStatus,
  managedDeviceToolCount,
  shortDeviceId,
  type ManagedDeviceStatusFilter,
} from './management-model';

const REFRESH_INTERVAL_MS = 5_000;
const DEVICE_PAGE_SIZE = 20;
const ACTIVITY_PAGE_SIZE = 20;
type ManagementTab = 'devices' | 'activity';

function statusClass(status: 'online' | 'offline' | 'revoked' | 'running' | 'succeeded' | 'failed') {
  if (status === 'online' || status === 'succeeded') return 'bg-success-soft text-success';
  if (status === 'running') return 'bg-accent-soft text-accent-fg';
  if (status === 'failed' || status === 'revoked') return 'bg-danger-soft text-danger';
  return 'bg-surface-hover text-fg-muted';
}

function StatusBadge({ status, label }: { status: Parameters<typeof statusClass>[0]; label: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClass(status))}>{label}</span>;
}

export function EndpointToolsManagementSettings() {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).endpointToolsSettings;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: ManagementTab = searchParams.get('view') === 'activity' ? 'activity' : 'devices';
  const [selectedDevice, setSelectedDevice] = useState<ManagedDevice | null>(null);
  const [revokeCandidates, setRevokeCandidates] = useState<ManagedDevice[]>([]);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ManagedDeviceStatusFilter>('active');
  const [platformFilter, setPlatformFilter] = useState('');
  const [devicePage, setDevicePage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activityQuery, setActivityQuery] = useState('');
  const [debouncedActivityQuery] = useDebounce(activityQuery, 250);
  const [activityPrincipal, setActivityPrincipal] = useState('');
  const [activityStatus, setActivityStatus] = useState<InvocationFilters['status']>('');
  const [activityEffect, setActivityEffect] = useState<InvocationFilters['effect']>('');
  const [activityPage, setActivityPage] = useState(1);
  const invocationFilters: InvocationFilters = {
    page: activityPage,
    pageSize: ACTIVITY_PAGE_SIZE,
    query: debouncedActivityQuery,
    principalId: activityPrincipal,
    status: activityStatus,
    effect: activityEffect,
  };
  const devices = useSWR(managedDevicesKey(), fetchManagedDevices, { refreshInterval: REFRESH_INTERVAL_MS });
  const invocations = useSWR(
    activeTab === 'activity' ? endpointInvocationsKey(invocationFilters) : null,
    () => fetchEndpointInvocations(invocationFilters),
    { refreshInterval: REFRESH_INTERVAL_MS, keepPreviousData: true },
  );
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );

  if (devices.isLoading && !devices.data) {
    return <SettingsPageFrame><SettingsPageSkeleton sections={2} /></SettingsPageFrame>;
  }

  const deviceRows = devices.data ?? [];
  const invocationRows = invocations.data?.items ?? [];
  const onlineDeviceCount = deviceRows.filter((device) => managedDeviceStatus(device) === 'online').length;
  const activeCount = deviceRows.filter((device) => managedDeviceStatus(device) !== 'revoked').length;
  const staleCount = deviceRows.filter((device) => isManagedDeviceStale(device)).length;
  const platforms = [...new Set(deviceRows.map((device) => device.platform))].sort();
  const filteredDevices = filterManagedDevices(deviceRows, {
    query,
    status: statusFilter,
    platform: platformFilter,
  });
  const devicePageCount = Math.max(1, Math.ceil(filteredDevices.length / DEVICE_PAGE_SIZE));
  const currentDevicePage = Math.min(devicePage, devicePageCount);
  const pagedDevices = filteredDevices.slice(
    (currentDevicePage - 1) * DEVICE_PAGE_SIZE,
    currentDevicePage * DEVICE_PAGE_SIZE,
  );
  const selectablePageIds = pagedDevices
    .filter((device) => managedDeviceStatus(device) !== 'revoked')
    .map((device) => device.id);
  const allPageSelected = selectablePageIds.length > 0 && selectablePageIds.every((id) => selectedIds.has(id));

  const setActiveTab = (tab: ManagementTab) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === 'devices') next.delete('view');
      else next.set('view', tab);
      return next;
    }, { replace: true });
  };
  const refresh = async () => {
    await Promise.all([devices.mutate(), activeTab === 'activity' ? invocations.mutate() : Promise.resolve()]);
  };
  const confirmRevoke = async () => {
    if (revokeCandidates.length === 0 || revoking) return;
    setRevoking(true);
    setRevokeError(false);
    try {
      await revokeManagedDevices(revokeCandidates.map((device) => device.id));
      setRevokeCandidates([]);
      setSelectedIds(new Set());
      await devices.mutate();
    } catch {
      setRevokeError(true);
    } finally {
      setRevoking(false);
    }
  };
  const updateDeviceFilters = (update: () => void) => {
    update();
    setDevicePage(1);
    setSelectedIds(new Set());
  };

  return (
    <SettingsPageFrame>
      <SettingsPageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={(
          <>
            <RefreshButton className="size-9 shrink-0 p-0" label={copy.refresh} onClick={refresh} />
            <DevicePairingAction onPaired={() => void devices.mutate()} />
          </>
        )}
      />

      {devices.error || invocations.error ? (
        <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{copy.loadError}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: copy.activeDevices, value: activeCount, filter: 'active' as const },
          { label: copy.onlineDevices, value: onlineDeviceCount, filter: 'online' as const },
          { label: copy.staleDevices, value: staleCount, filter: 'stale' as const },
        ].map(({ label, value, filter }) => (
          <button
            key={filter}
            type="button"
            className={cn(
              'touch-target rounded-xl px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              statusFilter === filter ? 'bg-surface-active' : 'bg-surface-hover/20 hover:bg-surface-hover/50',
            )}
            aria-pressed={statusFilter === filter}
            onClick={() => {
              updateDeviceFilters(() => setStatusFilter(filter));
              setActiveTab('devices');
            }}
          >
            <span className="text-xs text-fg-muted">{label}</span>
            <span className="mt-1 block text-2xl font-semibold text-fg">{value}</span>
          </button>
        ))}
      </div>

      <PageTabs
        items={[
          { id: 'devices', label: copy.devicesTab, icon: MonitorSmartphone, count: activeCount },
          { id: 'activity', label: copy.activityTab, icon: Activity, count: invocations.data?.total },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel={copy.viewsAria}
        tabIdPrefix="endpoint-management-tab"
        panelIdPrefix="endpoint-management-panel"
      />

      <SettingsTabPanel
        id="devices"
        activeTab={activeTab}
        tabIdPrefix="endpoint-management-tab"
        panelIdPrefix="endpoint-management-panel"
        title={copy.devicesTitle}
        hint={copy.devicesHint}
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <label className="relative block">
            <span className="sr-only">{copy.searchDevices}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              type="search"
              aria-label={copy.searchDevices}
              value={query}
              placeholder={copy.searchDevices}
              className="h-10 w-full rounded-lg border border-edge bg-surface-inset pl-9 pr-3 text-base text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
              onChange={(event) => updateDeviceFilters(() => setQuery(event.target.value))}
            />
          </label>
          <PopoverSelect
            value={statusFilter}
            options={[
              { value: 'active', label: copy.filterActive },
              { value: 'online', label: copy.status.online },
              { value: 'offline', label: copy.status.offline },
              { value: 'stale', label: copy.filterStale },
              { value: 'revoked', label: copy.status.revoked },
              { value: 'all', label: copy.filterAll },
            ]}
            placeholder={copy.statusLabel}
            allowEmpty={false}
            ariaLabel={copy.statusLabel}
            onChange={(value) => updateDeviceFilters(() => setStatusFilter(value as ManagedDeviceStatusFilter))}
          />
          <PopoverSelect
            value={platformFilter}
            options={platforms.map((platform) => ({ value: platform, label: platform }))}
            placeholder={copy.allPlatforms}
            emptyLabel={copy.allPlatforms}
            ariaLabel={copy.platformLabel}
            onChange={(value) => updateDeviceFilters(() => setPlatformFilter(value))}
          />
        </div>

        {selectedIds.size > 0 ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2">
            <p className="text-sm font-medium text-accent-fg">
              {copy.selectedCount.replace('{{count}}', String(selectedIds.size))}
            </p>
            <Button
              variant="secondary"
              className="text-danger"
              onClick={() => {
                setRevokeError(false);
                setRevokeCandidates(deviceRows.filter((device) => selectedIds.has(device.id)));
              }}
            >
              <ShieldOff className="size-4" aria-hidden />
              {copy.removeSelected}
            </Button>
          </div>
        ) : null}

        {deviceRows.length === 0 ? <p className="text-sm text-fg-muted">{copy.noDevices}</p>
          : filteredDevices.length === 0 ? <p className="text-sm text-fg-muted">{copy.noMatchingDevices}</p> : (
          <>
            <div className="flex min-h-10 items-center gap-3 border-b border-edge-subtle px-1">
              <label className={cn('touch-target flex items-center gap-2 text-xs text-fg-muted', selectablePageIds.length > 0 ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}>
                <input
                  type="checkbox"
                  aria-label={copy.selectPage}
                  checked={allPageSelected}
                  disabled={selectablePageIds.length === 0}
                  className="size-4 accent-accent"
                  onChange={(event) => {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      for (const id of selectablePageIds) {
                        if (event.target.checked) next.add(id);
                        else next.delete(id);
                      }
                      return next;
                    });
                  }}
                />
                {copy.selectPage}
              </label>
            </div>
            <ul className="divide-y divide-edge-subtle">
            {pagedDevices.map((device) => {
              const status = managedDeviceStatus(device);
              const DeviceIcon = device.kind === 'mobile' ? Smartphone : Laptop;
              return (
                <li key={device.id} className="flex items-center gap-3">
                  <label className={cn('touch-target flex size-10 shrink-0 items-center justify-center', status === 'revoked' ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(device.id)}
                      disabled={status === 'revoked'}
                      aria-label={copy.selectDevice.replace('{{name}}', device.displayName)}
                      className="size-4 accent-accent"
                      onChange={(event) => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(device.id);
                          else next.delete(device.id);
                          return next;
                        });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="touch-target flex min-w-0 flex-1 items-center gap-3 py-3 text-left hover:bg-surface-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => setSelectedDevice(device)}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-fg-muted">
                      <DeviceIcon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">{device.displayName}</span>
                        <StatusBadge status={status} label={copy.status[status]} />
                      </span>
                      <span className="mt-1 block text-xs text-fg-muted">
                        {device.platform} · {shortDeviceId(device.id)} · {copy.lastSeen}: {device.lastSeenAt ? formatter.format(device.lastSeenAt) : copy.never}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-right text-xs text-fg-muted sm:block">
                      {copy.endpointSummary.replace('{{endpoints}}', String(device.endpoints.length)).replace('{{tools}}', String(managedDeviceToolCount(device)))}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  </button>
                </li>
              );
            })}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge-subtle pt-3">
              <p className="text-xs text-fg-muted">
                {copy.paginationSummary
                  .replace('{{from}}', String((currentDevicePage - 1) * DEVICE_PAGE_SIZE + 1))
                  .replace('{{to}}', String(Math.min(currentDevicePage * DEVICE_PAGE_SIZE, filteredDevices.length)))
                  .replace('{{total}}', String(filteredDevices.length))}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="size-9 p-0"
                  aria-label={copy.previousPage}
                  disabled={currentDevicePage <= 1}
                  onClick={() => setDevicePage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  className="size-9 p-0"
                  aria-label={copy.nextPage}
                  disabled={currentDevicePage >= devicePageCount}
                  onClick={() => setDevicePage((page) => Math.min(devicePageCount, page + 1))}
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          </>
        )}
      </SettingsTabPanel>

      <SettingsTabPanel
        id="activity"
        activeTab={activeTab}
        tabIdPrefix="endpoint-management-tab"
        panelIdPrefix="endpoint-management-panel"
        title={copy.callsTitle}
        hint={copy.callsHint}
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative block sm:col-span-2 lg:col-span-1">
            <span className="sr-only">{copy.searchActivity}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              type="search"
              aria-label={copy.searchActivity}
              value={activityQuery}
              placeholder={copy.searchActivity}
              className="h-10 w-full rounded-lg border border-edge bg-surface-inset pl-9 pr-3 text-base text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
              onChange={(event) => {
                setActivityQuery(event.target.value);
                setActivityPage(1);
              }}
            />
          </label>
          <PopoverSelect
            value={activityPrincipal}
            options={deviceRows.map((device) => ({
              value: device.id,
              label: `${device.displayName} · ${shortDeviceId(device.id)}`,
            }))}
            placeholder={copy.allDevices}
            emptyLabel={copy.allDevices}
            ariaLabel={copy.deviceLabel}
            onChange={(value) => {
              setActivityPrincipal(value);
              setActivityPage(1);
            }}
          />
          <PopoverSelect
            value={activityStatus}
            options={[
              { value: 'running', label: copy.status.running },
              { value: 'succeeded', label: copy.status.succeeded },
              { value: 'failed', label: copy.status.failed },
            ]}
            placeholder={copy.allStatuses}
            emptyLabel={copy.allStatuses}
            ariaLabel={copy.statusLabel}
            onChange={(value) => {
              setActivityStatus(value as InvocationFilters['status']);
              setActivityPage(1);
            }}
          />
          <PopoverSelect
            value={activityEffect}
            options={[
              { value: 'read', label: copy.effects.read },
              { value: 'write', label: copy.effects.write },
              { value: 'destructive', label: copy.effects.destructive },
            ]}
            placeholder={copy.allEffects}
            emptyLabel={copy.allEffects}
            ariaLabel={copy.effectLabel}
            onChange={(value) => {
              setActivityEffect(value as InvocationFilters['effect']);
              setActivityPage(1);
            }}
          />
        </div>
        {invocations.isLoading && !invocations.data ? <SettingsPageSkeleton sections={1} /> : null}
        {invocationRows.length === 0 && !invocations.isLoading ? <p className="text-sm text-fg-muted">{copy.noMatchingCalls}</p> : null}
        <div className="space-y-2">
          {invocationRows.map((invocation) => (
            <div key={invocation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-base/55 px-3 py-2.5">
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-fg">{invocation.toolName}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {formatter.format(invocation.startedAt)} · {copy.effects[invocation.effect]} · {invocation.endpointId}
                </p>
                {invocation.errorMessage ? <p className="mt-1 text-xs text-danger">{invocation.errorMessage}</p> : null}
              </div>
              <StatusBadge status={invocation.status} label={copy.status[invocation.status]} />
            </div>
          ))}
        </div>
        {invocations.data && invocations.data.total > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge-subtle pt-3">
            <p className="text-xs text-fg-muted">
              {copy.paginationSummary
                .replace('{{from}}', String((invocations.data.page - 1) * invocations.data.pageSize + 1))
                .replace('{{to}}', String(Math.min(invocations.data.page * invocations.data.pageSize, invocations.data.total)))
                .replace('{{total}}', String(invocations.data.total))}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="size-9 p-0"
                aria-label={copy.previousPage}
                disabled={invocations.data.page <= 1}
                onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                className="size-9 p-0"
                aria-label={copy.nextPage}
                disabled={invocations.data.page >= invocations.data.totalPages}
                onClick={() => setActivityPage((page) => Math.min(invocations.data!.totalPages, page + 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}
      </SettingsTabPanel>

      <DeviceDetailDrawer
        device={selectedDevice}
        busy={revoking}
        onClose={() => setSelectedDevice(null)}
        onRevoke={(device) => {
          setSelectedDevice(null);
          setRevokeError(false);
          setRevokeCandidates([device]);
        }}
      />
      <ConfirmDialog
        open={revokeCandidates.length > 0}
        title={revokeCandidates.length > 1 ? copy.removeManyTitle : copy.removeTitle}
        description={`${revokeCandidates.length > 1
          ? copy.removeManyDescription.replace('{{count}}', String(revokeCandidates.length))
          : copy.removeDescription.replace('{{name}}', revokeCandidates[0]?.displayName ?? '')}${revokeError ? `\n\n${copy.revokeError}` : ''}`}
        confirmLabel={revoking ? copy.revoking : copy.removeDevice}
        cancelLabel={copy.cancel}
        destructive
        onConfirm={() => void confirmRevoke()}
        onCancel={() => { if (!revoking) setRevokeCandidates([]); }}
      />
    </SettingsPageFrame>
  );
}
