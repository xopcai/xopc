import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';

import { phoneRequest, type PhoneDevices } from './phone-api';

type Session = { id: string; status: string; expiresAt: number; qrPayload?: string; device?: PhoneDevices['discovery'][number]; errorCode?: string };
type Service = { name: string; host: string; port: number; kind: 'pairing' | 'connect' };
const field = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm';
const terminal = new Set(['connected', 'timeout', 'error', 'cancelled']);

export function WirelessPhoneForm({ zh, onSelect }: { zh: boolean; onSelect(device: PhoneDevices['discovery'][number]): void }) {
  const [method, setMethod] = useState('qr');
  const [session, setSession] = useState<Session>();
  const [qr, setQr] = useState('');
  const [host, setHost] = useState('');
  const [pairingPort, setPairingPort] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const current = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const select = useRef(onSelect); select.current = onSelect;
  const discovery = useSWR('phone-wireless-discovery', () => phoneRequest<{ mdns: boolean; services: Service[] }>('/wireless/discovery'), { refreshInterval: 4000 });
  const cancel = () => {
    generation.current++; const id = current.current; current.current = undefined;
    if (id) void phoneRequest(`/wireless/pairings/${id}`, undefined, 'DELETE').catch(() => {});
  };
  const start = async (mode: string) => {
    cancel(); const version = generation.current; setBusy(true); setError(''); setSession(undefined); setQr('');
    try {
      if (mode === 'connect') {
        const device = await phoneRequest<PhoneDevices['discovery'][number]>('/wireless/connect', { host, port: Number(connectPort) });
        if (generation.current === version) select.current(device);
      } else {
        const result = await phoneRequest<Session>('/wireless/pairings', mode === 'qr' ? { method: 'qr' }
          : { method: 'code', host, pairingPort: Number(pairingPort), code, ...(connectPort ? { connectPort: Number(connectPort) } : {}) });
        if (generation.current !== version) { void phoneRequest(`/wireless/pairings/${result.id}`, undefined, 'DELETE').catch(() => {}); return; }
        current.current = result.id; setSession(result); setCode('');
      }
    } catch (cause) { if (generation.current === version) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation.current === version) setBusy(false); }
  };
  useEffect(() => {
    if (method === 'qr') void start('qr');
    return cancel;
    // The form starts a fresh session only when changing pairing method.
  }, [method]);
  useEffect(() => {
    let active = true;
    setQr('');
    if (session?.qrPayload) void encodeMobilePairQr(session.qrPayload).then(value => { if (active) setQr(value); }).catch(() => { if (active) setError(zh ? '二维码生成失败，请重试' : 'Unable to render QR code'); });
    return () => { active = false; };
  }, [session?.qrPayload, zh]);
  useEffect(() => {
    if (!session || terminal.has(session.status)) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await phoneRequest<Session>(`/wireless/pairings/${session.id}`);
        if (!active) return;
        setSession(next); setNow(Date.now());
        if (next.status === 'connected' && next.device) { select.current(next.device); return; }
        if (!terminal.has(next.status)) timer = setTimeout(() => { void poll(); }, 1000);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        if (Date.now() < session.expiresAt + 5000) timer = setTimeout(() => { void poll(); }, 2000);
        else setSession(previous => previous ? { ...previous, status: 'timeout', qrPayload: undefined } : previous);
      }
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [session?.id, session?.status]);
  const labels: Record<string, string> = zh ? { waiting: '等待扫码', pairing: '正在配对', paired: '已配对，正在查找连接地址', connecting: '正在连接', connected: '已连接', timeout: '操作超时', error: '配对失败', cancelled: '已取消' }
    : { waiting: 'Waiting for scan', pairing: 'Pairing', paired: 'Paired · Finding connection address', connecting: 'Connecting', connected: 'Connected', timeout: 'Timed out', error: 'Pairing failed', cancelled: 'Cancelled' };
  const pending = busy || Boolean(session && !terminal.has(session.status));
  return <div className="space-y-4">
    <p className="rounded-xl bg-surface-inset p-3 text-sm">{zh ? '手机须与 Gateway 所在电脑处于同一局域网。仅浏览器与手机同网还不够。支持 Android 11 及以上。' : 'Android 11+. The phone and Gateway host must share a local network.'}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={zh ? '无线连接方式' : 'Wireless connection method'}>{[['qr', zh ? '扫码配对' : 'QR pairing'], ['code', zh ? '配对码' : 'Pairing code'], ['connect', zh ? '连接已配对设备' : 'Already paired']].map(([id, label]) => <Button key={id} aria-pressed={method === id} onClick={() => { cancel(); setBusy(false); setSession(undefined); setError(''); setQr(''); setMethod(id); }}>{label}</Button>)}</div>
    <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted"><li>{zh ? '打开手机「设置 → 开发者选项 → 无线调试」。' : 'Open Settings → Developer options → Wireless debugging.'}</li><li>{method === 'qr' ? (zh ? '选择「使用二维码配对设备」，扫描下方二维码。' : 'Choose Pair device with QR code and scan below.') : method === 'code' ? (zh ? '选择「使用配对码配对设备」，填写显示的地址和六位配对码。' : 'Choose Pair device with pairing code and enter its address and six-digit code.') : (zh ? '填写无线调试首页显示的 IP 地址与连接端口。' : 'Enter the IP and port shown on the main Wireless debugging screen.')}</li></ol>
    {discovery.isLoading && <Skeleton className="h-12 w-full" />}
    {(discovery.error || discovery.data?.mdns === false) && <p role="status" className="text-sm text-fg-muted">{zh ? '自动发现不可用。可使用配对码并手动填写连接端口。请检查 Gateway 的 ADB、网络及防火墙。' : 'Discovery unavailable. Use a pairing code and enter the connection port manually. Check Gateway ADB, network and firewall.'}</p>}
    {method === 'qr' ? <div className="space-y-3 text-center">
      {qr ? <img src={qr} alt={zh ? '无线调试配对二维码' : 'Wireless debugging pairing QR code'} className="mx-auto size-60 rounded-lg bg-white" /> : session && !terminal.has(session.status) ? <Skeleton className="mx-auto size-60" /> : null}
      {session && <p role="status" className="text-sm">{labels[session.status]}{!terminal.has(session.status) ? ` · ${Math.max(0, Math.ceil((session.expiresAt - now) / 1000))}s` : ''}</p>}
      <Button disabled={busy} onClick={() => { void start('qr'); }}>{zh ? '重新生成' : 'Regenerate'}</Button>
    </div> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void start(method); }}>
      {discovery.data?.services.filter(item => item.kind === (method === 'code' ? 'pairing' : 'connect')).map(item => <Button key={`${item.name}:${item.port}`} type="button" disabled={pending} onClick={() => { setHost(item.host); if (method === 'code') { setPairingPort(String(item.port)); const connection = discovery.data?.services.find(other => other.kind === 'connect' && other.host === item.host); setConnectPort(connection ? String(connection.port) : ''); } else setConnectPort(String(item.port)); }}>{item.host}:{item.port}</Button>)}
      <label className="block space-y-1 text-sm">{zh ? '手机 IP 地址' : 'Phone IP address'}<input className={field} value={host} onChange={event => setHost(event.target.value.trim())} required disabled={pending} placeholder="192.168.1.10" /></label>
      {method === 'code' && <><label className="block space-y-1 text-sm">{zh ? '配对端口' : 'Pairing port'}<input className={field} type="number" min={1} max={65535} value={pairingPort} onChange={event => setPairingPort(event.target.value)} required disabled={pending} /></label><label className="block space-y-1 text-sm">{zh ? '六位配对码' : 'Six-digit pairing code'}<input className={field} inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} required disabled={pending} /></label></>}
      <label className="block space-y-1 text-sm">{zh ? '连接端口' : 'Connection port'}<input className={field} type="number" min={1} max={65535} value={connectPort} onChange={event => setConnectPort(event.target.value)} required={method === 'connect'} disabled={pending} placeholder={zh ? '留空自动发现' : 'Auto-discover if empty'} /></label>
      <p className="text-xs text-fg-muted">{zh ? '连接端口在无线调试首页显示，与配对端口不同，会随设备状态变化。' : 'The connection port is on the main Wireless debugging screen. It differs from the pairing port and can change.'}</p>
      {session && <p role="status" className="text-sm">{labels[session.status]}</p>}
      <Button type="submit" disabled={pending}>{zh ? (method === 'code' ? '配对并连接' : '连接') : (method === 'code' ? 'Pair and connect' : 'Connect')}</Button>
    </form>}
    {session?.errorCode && <p role="alert" className="text-sm text-danger">{session.errorCode === 'PHONE_CONNECT_TIMEOUT' ? (zh ? '已配对，但未能连接。切换「连接已配对设备」并填写当前连接端口，无需重新配对。' : 'Paired but not connected. Use Already paired with the current connection port.') : zh ? '未完成配对。请检查手机配对页面、网络和配对码后重试。' : 'Pairing incomplete. Check the phone pairing screen, network and code, then retry.'}</p>}
    {pending && <Button onClick={() => { cancel(); setBusy(false); setSession(undefined); setQr(''); }}>{zh ? '取消配对' : 'Cancel pairing'}</Button>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
