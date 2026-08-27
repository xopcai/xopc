import { useEffect } from 'react';
import { useSWRConfig } from 'swr';

import { clearChatSkillsCache, clearSkillPaletteCaches } from '@/features/chat/palette/command-palette-api';
import { startAgentRunStreamEventBridge } from '@/features/gateway/agent-run-stream-event-bridge';
import { configReloadSection } from '@/features/gateway/config-reload-event';
import { useGatewayRealtime } from '@/features/gateway/use-gateway-realtime';

export function GatewayRealtimeBridge() {
  useGatewayRealtime();
  const { mutate } = useSWRConfig();
  useEffect(() => startAgentRunStreamEventBridge(), []);
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
