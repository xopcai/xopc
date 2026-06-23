import { useEffect } from 'react';

import {
  clearChatSkillsCache,
  clearSkillPaletteCaches,
} from '@/features/chat/palette/command-palette-api';
import { configReloadSection } from '@/features/gateway/config-reload-event';
import { useGatewaySse } from '@/features/gateway/use-gateway-sse';

/** Mount once under the app shell to run the SSE lifecycle hook. */
export function GatewaySseBridge() {
  useGatewaySse();
  useEffect(() => {
    const onConfigReload = (event: Event) => {
      const section = configReloadSection((event as CustomEvent<unknown>).detail);
      if (section === 'skills') {
        clearSkillPaletteCaches();
      } else if (section === 'agents') {
        clearChatSkillsCache();
      }
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, []);
  return null;
}
