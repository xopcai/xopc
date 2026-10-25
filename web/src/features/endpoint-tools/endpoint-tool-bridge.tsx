import { useEffect } from 'react';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { isElectron } from '@/lib/electron-env';
import { publishTurnEnvironmentSupport } from './turn-environment';
import { DESKTOP_ENDPOINT_TOOL_DEFINITIONS } from './desktop-tools';
import { EndpointToolConfirmationDialog } from './confirmation-dialog';
import { EndpointToolHost } from './host';
import { EndpointReenrollmentDialog } from './reenrollment-dialog';
import { requestEndpointReenrollment, settleEndpointReenrollment } from './reenrollment-store';
import { WEB_ENDPOINT_TOOL_DEFINITIONS } from './tools';
import { publishEndpointTurnClaim, clearEndpointTurnClaim } from './turn-claim';
import { createEndpointContextPublisher } from './context-publisher';

export function EndpointToolBridge() {
  useEffect(() => {
    const desktop = isElectron();
    if (desktop && window.electronAPI?.computer) {
      let stopped = false;
      let environmentSupported = false;
      let activeToken: string | undefined;
      const contextPublisher = createEndpointContextPublisher();
      const refreshContext = () => { void contextPublisher.refresh(); };
      document.addEventListener('visibilitychange', refreshContext);
      window.addEventListener('focus', refreshContext);
      window.addEventListener('blur', refreshContext);
      void apiFetch(apiUrl('/api/endpoint-tools/compatibility')).then(async response => {
        const body = await response.json();
        environmentSupported = response.ok && body?.payload?.endpointEnvironmentV1 === true;
        if (!stopped) publishTurnEnvironmentSupport(response.ok && body?.payload?.turnDeviceContextV1 === true);
      }).catch(() => { if (!stopped) publishTurnEnvironmentSupport(false); });
      const sync = async () => {
        try {
          const state = await window.electronAPI!.computer!.status();
          if (stopped) return;
          if (state.claim) {
            publishEndpointTurnClaim(state.claim.endpointId, state.claim.token);
            if (environmentSupported && activeToken !== state.claim.token) {
              activeToken = state.claim.token;
              contextPublisher.start(state.claim);
            }
          } else { activeToken = undefined; contextPublisher.stop(); clearEndpointTurnClaim(); }
        } catch { if (!stopped) { activeToken = undefined; contextPublisher.stop(); clearEndpointTurnClaim(); } }
      };
      void sync();
      const timer = window.setInterval(() => { void sync(); }, 1000);
      return () => {
        stopped = true; contextPublisher.stop();
        document.removeEventListener('visibilitychange', refreshContext);
        window.removeEventListener('focus', refreshContext);
        window.removeEventListener('blur', refreshContext);
        publishTurnEnvironmentSupport(false); window.clearInterval(timer); clearEndpointTurnClaim();
      };
    }
    const host = new EndpointToolHost(desktop ? {
      kind: 'desktop',
      platform: window.electronAPI?.platform ?? 'desktop',
      displayName: 'xopc Desktop',
      appVersion: '1',
      definitions: DESKTOP_ENDPOINT_TOOL_DEFINITIONS,
      confirmReenrollment: requestEndpointReenrollment,
    } : {
      kind: 'web',
      platform: 'web',
      displayName: 'Web browser',
      appVersion: '1',
      definitions: WEB_ENDPOINT_TOOL_DEFINITIONS,
      confirmReenrollment: requestEndpointReenrollment,
    });
    void host.start();
    return () => {
      settleEndpointReenrollment(false);
      host.stop();
    };
  }, []);

  return (
    <>
      <EndpointToolConfirmationDialog />
      <EndpointReenrollmentDialog />
    </>
  );
}
