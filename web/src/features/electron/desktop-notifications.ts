import { isElectron } from '@/lib/electron-env';

export type DesktopNotificationPrefs = {
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
};

export const SHELL_PREFS_CHANGED_EVENT = 'xopc:shell-prefs-changed';

let cachedPrefs: DesktopNotificationPrefs = {
  notifyEnabled: true,
  notifySoundEnabled: true,
};

export function getDesktopNotificationPrefs(): DesktopNotificationPrefs {
  return cachedPrefs;
}

export function dispatchShellPrefsChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(SHELL_PREFS_CHANGED_EVENT));
}

export async function refreshDesktopNotificationPrefs(): Promise<DesktopNotificationPrefs> {
  if (!isElectron() || !window.electronAPI?.system) {
    return cachedPrefs;
  }
  try {
    const behavior = await window.electronAPI.system.getBehavior();
    cachedPrefs = {
      notifyEnabled: behavior.notifyEnabled,
      notifySoundEnabled: behavior.notifySoundEnabled,
    };
  } catch {
    /* keep last cached */
  }
  return cachedPrefs;
}

function playNotificationBeep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.07;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    void ctx.close();
  } catch {
    /* ignore — OS may still play a sound */
  }
}

export type ShowDesktopNotificationOptions = {
  title: string;
  body?: string;
  tag?: string;
  /** Show even when the window is focused (e.g. test notification). */
  force?: boolean;
  /** Show for warning/error even when the window is focused. */
  urgent?: boolean;
};

/**
 * Show a native Notification when desktop notifications are enabled and permission is granted.
 * By default only fires while the document is hidden, unless `force` or `urgent` is set.
 */
export function showDesktopNotification(options: ShowDesktopNotificationOptions): boolean {
  if (typeof Notification === 'undefined') {
    return false;
  }
  const prefs = getDesktopNotificationPrefs();
  if (!prefs.notifyEnabled && !options.force) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }
  const title = options.title.trim();
  if (!title) {
    return false;
  }
  if (!options.force && !options.urgent && !document.hidden) {
    return false;
  }

  try {
    const notification = new Notification(title, {
      body: options.body?.trim() || undefined,
      tag: options.tag,
      silent: !prefs.notifySoundEnabled,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    if (prefs.notifySoundEnabled) {
      playNotificationBeep();
    }
    return true;
  } catch {
    return false;
  }
}

export type EnableDesktopNotificationsResult = 'enabled' | 'denied' | 'default' | 'unsupported';

/**
 * Request notification permission (if needed) and show a test notification when enabling.
 */
export async function enableDesktopNotificationsWithTest(
  testTitle: string,
  testBody: string,
): Promise<EnableDesktopNotificationsResult> {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }

  if (isElectron() && window.electronAPI?.system?.requestNotifications) {
    const result = await window.electronAPI.system.requestNotifications();
    if (result.status !== 'granted') {
      if (result.outcome === 'opened-settings' || result.status === 'denied') {
        return 'denied';
      }
      return 'default';
    }
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return permission === 'denied' ? 'denied' : 'default';
      }
    } else if (Notification.permission === 'denied') {
      return 'denied';
    }
    cachedPrefs = { ...cachedPrefs, notifyEnabled: true };
    showDesktopNotification({ title: testTitle, body: testBody, tag: 'xopc-notify-test', force: true });
    return 'enabled';
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission === 'denied') {
    return 'denied';
  }
  if (permission !== 'granted') {
    return 'default';
  }
  cachedPrefs = { ...cachedPrefs, notifyEnabled: true };
  showDesktopNotification({ title: testTitle, body: testBody, tag: 'xopc-notify-test', force: true });
  return 'enabled';
}
