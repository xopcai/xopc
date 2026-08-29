import { isElectron } from '@/lib/electron-env';

export type EnableDesktopNotificationsResult = 'enabled' | 'denied' | 'default' | 'unsupported';

/** Requests native notification access and verifies it with a main-process notification. */
export async function enableDesktopNotificationsWithTest(
  testTitle: string,
  testBody: string,
): Promise<EnableDesktopNotificationsResult> {
  const system = window.electronAPI?.system;
  if (!isElectron() || !system?.requestNotifications) return 'unsupported';
  const result = await system.requestNotifications();
  if (result.status !== 'granted') {
    if (result.outcome === 'opened-settings' || result.status === 'denied') return 'denied';
    return 'default';
  }
  await system.setBehavior({ notifyEnabled: true });
  const shown = await system.showEndpointNotification({ title: testTitle, body: testBody });
  if (!shown.ok) await system.setBehavior({ notifyEnabled: false });
  return shown.ok ? 'enabled' : 'default';
}
