import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { browserNotificationsSupported } from '@/features/notifications/browser-notification-delivery';

import { sceneErrorText, sceneWrite } from './api';

export function BrowserReminders({ zh }: { zh: boolean }) {
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<unknown>();
  const [permissionDenied, setPermissionDenied] = useState(false);
  async function enable() {
    setBusy(true); setError(undefined); setPermissionDenied(false);
    try {
      if (await Notification.requestPermission() !== 'granted') { setPermissionDenied(true); return; }
      const { publicKey } = await sceneWrite<{ publicKey: string }>('/browser/prepare', 'POST');
      await navigator.serviceWorker.register('/notification-sw.js');
      const registration = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      let subscription = await registration.pushManager.getSubscription();
      const previousKey = subscription?.options.applicationServerKey;
      if (subscription && (!previousKey || !new Uint8Array(previousKey).every((byte, index) => byte === key[index]) || previousKey.byteLength !== key.byteLength)) {
        await subscription.unsubscribe(); subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await sceneWrite('/browser/subscriptions', 'POST', { ...subscription.toJSON(), expirationTime: subscription.expirationTime, language: zh ? 'zh' : 'en' });
      setEnabled(true);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  const supported = browserNotificationsSupported() && 'PushManager' in window;
  return <div className="space-y-2 border-t border-edge pt-3">
    <Button disabled={busy || !supported} onClick={() => void enable()}>{enabled ? (zh ? '刷新此浏览器提醒订阅' : 'Refresh this browser subscription') : (zh ? '开启页面关闭后的浏览器提醒' : 'Enable reminders when this page is closed')}</Button>
    {enabled && <p role="status">{zh ? '此浏览器已订阅。服务需持续运行；送达取决于浏览器和系统权限。' : 'Subscribed. The Gateway must remain running; delivery depends on browser and system permissions.'}</p>}
    {(!supported || permissionDenied) && <p className="text-fg-muted">{zh ? '当前环境或通知权限不支持后台提醒。成果仍会保留在智能关注收件箱；可在支持推送的 HTTPS 浏览器中开启。' : 'Background reminders are unavailable here. Results remain in your monitor inbox. Use a push-capable HTTPS browser and allow notifications.'}</p>}
    {error != null && <p role="alert" className="text-danger">{sceneErrorText(error, zh)}</p>}
  </div>;
}
