import { useEffect } from 'react';

import {
  refreshDesktopNotificationPrefs,
  showDesktopNotification,
  SHELL_PREFS_CHANGED_EVENT,
} from '@/features/electron/desktop-notifications';
import { isElectron } from '@/lib/electron-env';
import { TOAST_EVENT } from '@/lib/toast';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type ExtensionNotificationDetail = {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message?: string;
};

type AgentStreamDetail = {
  sessionKey?: string;
  event?: { type?: string; content?: string; status?: string };
};

/**
 * Mirrors in-app toasts to OS notifications when the user enabled desktop notifications
 * and the window is in the background (warnings/errors also fire while focused).
 */
export function DesktopNotificationBridge() {
  const language = useLocaleStore((s) => s.language);

  useEffect(() => {
    if (!isElectron()) {
      return;
    }
    void refreshDesktopNotificationPrefs();

    const onPrefsChanged = () => {
      void refreshDesktopNotificationPrefs();
    };
    window.addEventListener(SHELL_PREFS_CHANGED_EVENT, onPrefsChanged);
    return () => window.removeEventListener(SHELL_PREFS_CHANGED_EVENT, onPrefsChanged);
  }, []);

  useEffect(() => {
    if (!isElectron()) {
      return;
    }

    const copy = messages(language).systemSettings.desktopNotify;

    const onExtensionNotification = (e: Event) => {
      const d = (e as CustomEvent<ExtensionNotificationDetail>).detail;
      const title = typeof d?.title === 'string' ? d.title.trim() : '';
      if (!title) {
        return;
      }
      const body = typeof d?.message === 'string' ? d.message.trim() : undefined;
      const urgent = d?.type === 'error' || d?.type === 'warning';
      showDesktopNotification({
        title,
        body,
        tag: `xopc-toast-${d?.type ?? 'info'}`,
        urgent,
      });
    };

    const onAgentStream = (e: Event) => {
      const d = (e as CustomEvent<AgentStreamDetail>).detail;
      const event = d?.event;
      if (!event || event.type !== 'error') {
        return;
      }
      const content = typeof event.content === 'string' ? event.content.trim() : '';
      showDesktopNotification({
        title: copy.agentErrorTitle,
        body: content || copy.agentErrorBody,
        tag: `xopc-agent-error-${d?.sessionKey ?? 'unknown'}`,
        urgent: true,
      });
    };

    window.addEventListener(TOAST_EVENT, onExtensionNotification);
    window.addEventListener('agent-stream-event', onAgentStream);
    return () => {
      window.removeEventListener(TOAST_EVENT, onExtensionNotification);
      window.removeEventListener('agent-stream-event', onAgentStream);
    };
  }, [language]);

  return null;
}
