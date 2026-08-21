import { useEffect } from 'react';

import {
  refreshDesktopNotificationPrefs,
  showDesktopNotification,
  SHELL_PREFS_CHANGED_EVENT,
} from '@/features/electron/desktop-notifications';
import { isElectron } from '@/lib/electron-env';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type AgentStreamDetail = {
  sessionKey?: string;
  event?: { type?: string; content?: string; status?: string };
};

/**
 * Sends background agent failures to the OS when desktop notifications are enabled.
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
        urgent: false,
      });
    };

    window.addEventListener('agent-stream-event', onAgentStream);
    return () => {
      window.removeEventListener('agent-stream-event', onAgentStream);
    };
  }, [language]);

  return null;
}
