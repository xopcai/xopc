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

export function EndpointToolBridge() {
  useEffect(() => {
    const desktop = isElectron();
    if (desktop && window.electronAPI?.computer) {
      let stopped = false;
      void apiFetch(apiUrl('/api/endpoint-tools/compatibility')).then(async response => {
        const body = await response.json();
        if (!stopped) publishTurnEnvironmentSupport(response.ok && body?.payload?.turnDeviceContextV1 === true);
      }).catch(() => { if (!stopped) publishTurnEnvironmentSupport(false); });
      const sync = async () => {
        try {
          const state = await window.electronAPI!.computer!.status();
          if (stopped) return;
          if (state.claim) publishEndpointTurnClaim(state.claim.endpointId, state.claim.token);
          else clearEndpointTurnClaim();
        } catch { if (!stopped) clearEndpointTurnClaim(); }
      };
      void sync();
      const timer = window.setInterval(() => { void sync(); }, 1000);
      return () => { stopped = true; publishTurnEnvironmentSupport(false); window.clearInterval(timer); clearEndpointTurnClaim(); };
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
