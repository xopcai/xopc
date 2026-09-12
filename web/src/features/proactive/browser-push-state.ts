import { apiUrl } from '@/lib/url';

export const browserPushStorageKey = () => `xopc-proactive-web-push:${apiUrl('/api')}`;
export function browserPushRegistered(): boolean {
  try { return Notification.permission === 'granted' && Boolean(localStorage.getItem(browserPushStorageKey())); } catch { return false; }
}
