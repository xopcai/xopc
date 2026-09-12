import { useEffect } from 'react';
import { useSWRConfig } from 'swr';

import { clearChatSkillsCache, clearSkillPaletteCaches } from '@/features/chat/palette/command-palette-api';
import { startChatRunStateBridge } from '@/features/chat/session/chat-run-state-bridge';
import { startAgentRunStreamEventBridge } from '@/features/gateway/agent-run-stream-event-bridge';
import { configReloadSection } from '@/features/gateway/config-reload-event';
import { useGatewayRealtime } from '@/features/gateway/use-gateway-realtime';
import { proactiveWrite } from '@/features/proactive/api';

export function GatewayRealtimeBridge() {
  useGatewayRealtime();
  const { mutate } = useSWRConfig();
  useEffect(() => startAgentRunStreamEventBridge(), []);
  useEffect(() => startChatRunStateBridge(), []);
  useEffect(() => {
    const clientId = crypto.randomUUID();
    const report = (active = document.visibilityState === 'visible' && document.hasFocus()) => {
      void proactiveWrite('/api/proactive/presence', 'POST', { clientId, active, surface: 'web' }).catch(() => {});
    };
    const changed = () => report();
    const timer = window.setInterval(changed, 30000);
    report();
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('focus', changed);
    window.addEventListener('blur', changed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('focus', changed);
      window.removeEventListener('blur', changed);
      report(false);
    };
  }, []);
  useEffect(() => {
    const onConfigReload = (event: Event) => {
      const section = configReloadSection((event as CustomEvent<unknown>).detail);
      if (section === 'skills') clearSkillPaletteCaches();
      else if (section === 'agents') clearChatSkillsCache();
    };
    const onGap = (event: Event) => {
      const topic = (event as CustomEvent<{ topic?: string }>).detail?.topic;
      if (topic === 'gateway' || topic === 'sessions') void mutate(() => true);
    };
    window.addEventListener('config-reload', onConfigReload);
    window.addEventListener('realtime-gap', onGap);
    return () => {
      window.removeEventListener('config-reload', onConfigReload);
      window.removeEventListener('realtime-gap', onGap);
    };
  }, [mutate]);
  return null;
}
