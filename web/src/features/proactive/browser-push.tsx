import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { isElectron } from '@/lib/electron-env';
import { proactiveGet, proactiveWrite } from './api';

import { browserPushStorageKey, browserPushRegistered } from './browser-push-state';

export function BrowserPushControls({ zh }: { zh: boolean }) {
  const [registered, setRegistered] = useState(browserPushRegistered);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const probes = useSWR<{ probes: Array<{ id: string; status: string; createdAt: number; error?: string }> }>(registered ? '/api/proactive/web-push/probes' : null, proactiveGet, { refreshInterval: 10000 });
  async function testPush() {
    setBusy(true); setError('');
    try { const id = localStorage.getItem(browserPushStorageKey()); if (!id) throw new Error('Enable this browser first'); await proactiveWrite(`/api/proactive/web-push/subscriptions/${encodeURIComponent(id)}/test`, 'POST', {}); await probes.mutate(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }
  const supported = !isElectron() && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function toggle() {
    setBusy(true); setError('');
    try {
      if (registered) {
        const id = localStorage.getItem(browserPushStorageKey());
        if (id) await proactiveWrite(`/api/proactive/web-push/subscriptions/${encodeURIComponent(id)}`, 'DELETE', {});
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
        localStorage.removeItem(browserPushStorageKey()); setRegistered(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(zh ? '浏览器未允许通知。' : 'Browser notification permission was not granted.');
      const { publicKey } = await proactiveWrite<{ publicKey: string }>('/api/proactive/web-push/prepare', 'POST', {});
      await navigator.serviceWorker.register('/notification-sw.js');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      const { id } = await proactiveWrite<{ id: string }>('/api/proactive/web-push/subscriptions', 'POST', { subscription: subscription.toJSON(), language: zh ? 'zh' : 'en' });
      localStorage.setItem(browserPushStorageKey(), id); setRegistered(true);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <section className="max-w-2xl rounded-2xl border border-edge bg-surface-panel p-5">
    <h2 className="font-medium">{zh ? '网页关闭后也接收提醒' : 'Receive alerts when this page is closed'}</h2>
    <p className="mt-2 text-sm text-fg-muted">{zh ? 'Gateway 需要保持在线。锁屏通知只显示通用提示，详情在应用内查看。' : 'Keep the Gateway online. Lock-screen notifications contain a generic summary; open the app for details.'}</p>
    <Button className="mt-4" disabled={busy || !supported} onClick={() => void toggle()}>{!supported ? (zh ? '当前环境不支持 Web Push' : 'Web Push is unavailable here') : registered ? (zh ? '关闭此浏览器推送' : 'Disable browser push') : (zh ? '启用此浏览器推送' : 'Enable browser push')}</Button>
    {registered && <Button className="ml-2 mt-4" disabled={busy} onClick={() => void testPush()}>{zh ? '向此浏览器发送测试通知' : 'Send a test to this browser'}</Button>}
    {probes.data?.probes.slice(0, 3).map((probe) => <p key={probe.id} className="mt-2 text-xs text-fg-muted">{new Date(probe.createdAt).toLocaleString()} · {probe.status === 'opened' ? (zh ? '已点击打开' : 'Opened') : probe.status === 'accepted' ? (zh ? '提供方已接受，等待点击确认' : 'Provider accepted; awaiting open confirmation') : probe.status}{probe.error && ` · ${probe.error}`}</p>)}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </section>;
}
