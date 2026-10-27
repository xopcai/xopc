import * as Dialog from '@radix-ui/react-dialog';
import { MapPin, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { EndpointTurnClaim, LocationShareSummary } from '@xopcai/endpoint-tools-protocol';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { waitForEndpointTurnClaim } from '@/features/endpoint-tools/turn-claim';
import { refreshLocalEndpointContext } from '@/features/endpoint-tools/context-publisher';

const root = '/api/user-context/environment/location-shares';
export async function acquireSharedLocation(precision: 'approximate' | 'precise', signal: AbortSignal) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new DOMException('Location cancelled', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', cancel);
    if (signal.aborted) { cancel(); return; }
    if (!navigator.geolocation) { reject(new Error('Location is unavailable on this device')); return; }
    signal.addEventListener('abort', cancel, { once: true });
    navigator.geolocation.getCurrentPosition(position => {
      cleanup(); if (signal.aborted) return;
      const approximate = precision === 'approximate' || position.coords.accuracy > 1000;
      resolve({ latitude: approximate ? Math.round(position.coords.latitude * 50) / 50 : position.coords.latitude,
        longitude: approximate ? Math.round(position.coords.longitude * 50) / 50 : position.coords.longitude,
        accuracyMeters: approximate ? Math.max(3000, position.coords.accuracy) : position.coords.accuracy,
        precision: approximate ? 'approximate' : 'precise', capturedAt: position.timestamp, coordinateSystem: 'WGS84' });
    }, () => { cleanup(); if (!signal.aborted) reject(new Error('Location permission was denied or a fresh fix is unavailable')); },
    { maximumAge: 0, timeout: 15_000, enableHighAccuracy: precision === 'precise' });
  });
}

export function PhoneLocationShare({ phoneId, conversationId }: { phoneId: string; conversationId: string }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'once' | 'while_in_use'>('once');
  const [precision, setPrecision] = useState<'approximate' | 'precise'>('approximate');
  const [share, setShare] = useState<LocationShareSummary>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  type ActiveShare = { share: LocationShareSummary; origin: EndpointTurnClaim; sequence: number; abort: AbortController };
  const active = useRef<ActiveShare | undefined>(undefined);
  const inFlight = useRef<ActiveShare | undefined>(undefined);
  const generation = useRef(0);
  const environmentPath = `/api/phone/devices/${phoneId}/environment`;
  const environment = useSWR(environmentPath, async () => (await fetchJson<{payload: {status: string; recoveryRequired?: boolean; supported?: boolean}}>(apiUrl(environmentPath))).payload,
    { refreshInterval: 2000, shouldRetryOnError: false });
  const request = async (path: string, method: string, body?: unknown) => {
    const response = await apiFetch(apiUrl(path), { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? 'Location sharing is unavailable');
    return result.payload as LocationShareSummary;
  };
  const stop = async () => {
    const current = active.current; active.current = undefined; current?.abort.abort();
    if (!current) return;
    try { setShare(await request(`${root}/${current.share.id}`, 'DELETE', { origin: current.origin })); }
    catch { setError(zh ? '共享已停止，远端清理状态待确认。' : 'Sharing stopped; remote cleanup needs confirmation.'); }
  };
  useEffect(() => {
    let disposed = false; let permission: PermissionStatus | undefined;
    const visibility = () => { if (document.hidden) void stop(); };
    const permissionChanged = () => { if (permission?.state === 'denied') void stop(); };
    void navigator.permissions?.query({ name: 'geolocation' }).then(result => {
      if (disposed) return;
      permission = result; permission.addEventListener('change', permissionChanged); permissionChanged();
    }).catch(() => {});
    document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; generation.current++; permission?.removeEventListener('change', permissionChanged); document.removeEventListener('visibilitychange', visibility); void stop(); };
    // The source and target are fixed for a mounted share. Cleanup owns the captured grant.
  }, [phoneId, conversationId]);
  async function upload() {
    const current = active.current;
    if (!current || current.abort.signal.aborted || inFlight.current === current || document.hidden) return;
    inFlight.current = current;
    try {
      const sample = await acquireSharedLocation(current.share.precision, current.abort.signal);
      await refreshLocalEndpointContext();
      current.abort.signal.throwIfAborted(); if (document.hidden) return;
      const result = await request(`${root}/${current.share.id}/samples`, 'POST', { origin: current.origin, sequence: ++current.sequence, sample });
      if (active.current !== current) return;
      current.share = result; setShare(result);
      if (result.sync === 'failed') { setError(zh ? '定位同步未通过验证，请停止共享后检查云手机。' : 'Location synchronization was not verified. Stop sharing and inspect the phone.'); await stop(); }
    } catch (failure) {
      if (!current.abort.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Location unavailable'); await stop(); }
    } finally { if (inFlight.current === current) inFlight.current = undefined; }
  }
  useEffect(() => {
    if (!share || ['revoked', 'expired', 'source_unavailable'].includes(share.status)) return;
    const timer = setInterval(() => {
      const current = active.current;
      if (!current) return;
      if (Date.now() >= current.share.expiresAt) { void stop(); return; }
      void fetchJson<{ payload: LocationShareSummary[] }>(apiUrl(`${root}?endpointId=${encodeURIComponent(current.origin.endpointId)}&conversationId=${conversationId}`))
        .then(result => {
          if (active.current !== current) return;
          const latest = result.payload.find(item => item.id === current.share.id);
          if (latest) { current.share = latest; setShare(latest); if (['revoked', 'expired', 'source_unavailable'].includes(latest.status) || latest.sync === 'clean') void stop(); }
        }).catch(() => {});
    }, 2000);
    const sampleTimer = mode === 'while_in_use' ? setInterval(() => { void upload(); }, 10_000) : undefined;
    return () => { clearInterval(timer); clearInterval(sampleTimer); };
  }, [share?.id, mode, conversationId]);
  async function start() {
    const currentGeneration = generation.current;
    setBusy(true); setError('');
    try {
      const origin = await waitForEndpointTurnClaim(); await refreshLocalEndpointContext();
      const result = await request(root, 'POST', { origin, disclosureVersion: 'location-sharing-v1',
        request: { phoneId, conversationId, mode, precision, durationMs: mode === 'once' ? 120_000 : 300_000 } });
      if (generation.current !== currentGeneration) { await request(`${root}/${result.id}`, 'DELETE', { origin }); return; }
      active.current = { share: result, origin, sequence: 0, abort: new AbortController() }; setShare(result); setOpen(false);
      await upload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Location unavailable'); }
    finally { setBusy(false); }
  }
  const sharing = share && !['revoked', 'expired', 'source_unavailable'].includes(share.status);
  const cleanupPending = environment.data?.status === 'cleanup_pending' || environment.data?.recoveryRequired
    || share?.sync === 'cleanup_pending';
  async function retryCleanup() {
    setBusy(true);
    try {
      const response = await fetchJson<{ payload: { cleared: boolean } }>(apiUrl(`${environmentPath}/cleanup`), { method: 'POST' });
      if (response.payload.cleared) setShare(current => current ? { ...current, sync: 'clean' } : current);
      await environment.mutate();
    } catch { setError(zh ? '清理仍待完成，请检查云手机连接。' : 'Cleanup remains pending. Check the cloud phone connection.'); }
    finally { setBusy(false); }
  }
  if (environment.data?.supported === false) return null;
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && busy) { generation.current++; void stop(); } setOpen(value); }}>
    <div className="flex items-center gap-1" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <Button variant="ghost" className="h-8 px-2" onClick={() => sharing ? void stop() : setOpen(true)} disabled={busy || !sharing && Boolean(cleanupPending)} aria-label={sharing ? (zh ? '停止共享位置' : 'Stop location sharing') : (zh ? '共享当前位置' : 'Share current location')}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
        {sharing ? (zh ? '停止共享' : 'Stop sharing') : null}
      </Button>
      {cleanupPending && <Button variant="ghost" disabled={busy} onClick={() => void retryCleanup()}>{zh ? '重试定位清理' : 'Retry location cleanup'}</Button>}
      {share?.sync === 'applied' && <span role="status" className="text-xs text-fg-muted">{zh ? '位置已同步' : 'Location synced'}</span>}
      {error && <span role="alert" className="max-w-40 truncate text-xs text-fg-muted" title={error}>{error}</span>}
    </div>
    <Dialog.Portal><Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[90] bg-scrim" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[91] flex h-[min(430px,90dvh)] w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel p-5">
        <header className="flex shrink-0 items-center justify-between"><Dialog.Title className="font-semibold text-fg">{zh ? '共享当前位置到云手机' : 'Share current location with cloud phone'}</Dialog.Title><Dialog.Close aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Dialog.Close></header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-5 text-sm text-fg-muted">
          <Dialog.Description>{zh ? '从你正在使用的设备获取位置，经 Gateway 同步到这台云手机。有定位权限的应用均可能读取，任务模型也可能从画面看到位置信息。原始采样坐标不写入聊天或长期记忆。' : 'Share this device’s location via Gateway. Apps with location permission and task models viewing the phone may see location information. Raw samples stay out of chat and long-term memory.'}</Dialog.Description>
          <label className="block">{zh ? '共享方式' : 'Sharing mode'}<Select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><SelectOption value="once">{zh ? '仅本次，位置 30 秒后过期' : 'Once, location expires after 30 seconds'}</SelectOption><SelectOption value="while_in_use">{zh ? '前台使用期间，最多 5 分钟' : 'While in use, up to 5 minutes'}</SelectOption></Select></label>
          <label className="block">{zh ? '定位精度' : 'Precision'}<Select value={precision} onChange={event => setPrecision(event.target.value as typeof precision)}><SelectOption value="approximate">{zh ? '大概位置' : 'Approximate'}</SelectOption><SelectOption value="precise">{zh ? '精确位置' : 'Precise'}</SelectOption></Select></label>
          <p>{zh ? '停止共享或位置过期后，恢复云手机原有定位；断线时显示清理待完成，恢复前暂停依赖定位的任务。第三方应用已保存的信息无法撤回。' : 'Stopping or expiry restores the phone’s previous location. Offline cleanup remains pending and dependent tasks pause. Data already saved by other apps cannot be recalled.'}</p>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2"><Dialog.Close asChild><Button variant="ghost">{zh ? '取消' : 'Cancel'}</Button></Dialog.Close><Button disabled={busy} onClick={() => void start()}>{zh ? '同意并共享' : 'Agree and share'}</Button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
