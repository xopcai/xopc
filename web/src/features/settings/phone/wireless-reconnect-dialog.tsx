import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { phoneRequest, type PhoneDevice } from './phone-api';

export function WirelessReconnectDialog({ device, zh, onClose, onConnected }: { device: PhoneDevice; zh: boolean; onClose(): void; onConnected(): Promise<void> }) {
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState(device.wireless?.host ?? '');
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await phoneRequest(`/devices/${device.id}/reconnect`, manual ? { host, port: Number(port) } : {}); await onConnected(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setManual(true); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(28rem,90dvh)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay p-5 text-fg">
      <Dialog.Title className="text-base font-semibold">{zh ? '重新连接手机' : 'Reconnect phone'} · {device.name}</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-fg-muted">{zh ? '开启手机无线调试，并连接 Gateway 所在局域网。重连会保留设备权限，之前的任务需要重新打开。' : 'Enable wireless debugging on the Gateway network. Device permissions are preserved; reopen the previous task.'}</Dialog.Description>
      <form className="mt-4 flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={manual} disabled={busy} onChange={event => setManual(event.target.checked)} />{zh ? '手动填写当前连接地址' : 'Enter current connection address'}</label>
          {manual && <><label className="block text-sm">{zh ? '手机 IP 地址' : 'Phone IP address'}<input className="mt-1 w-full rounded-lg border border-edge bg-surface-base p-2" required value={host} disabled={busy} onChange={event => setHost(event.target.value.trim())} /></label><label className="block text-sm">{zh ? '连接端口（无线调试首页）' : 'Connection port (Wireless debugging screen)'}<input className="mt-1 w-full rounded-lg border border-edge bg-surface-base p-2" type="number" min={1} max={65535} required value={port} disabled={busy} onChange={event => setPort(event.target.value)} /></label></>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
        <footer className="mt-4 flex shrink-0 justify-end gap-2 border-t border-edge pt-4"><Button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? (zh ? '正在连接…' : 'Connecting…') : (zh ? '重新连接' : 'Reconnect')}</Button></footer>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
