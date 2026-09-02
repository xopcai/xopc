import { useEffect } from 'react';

import { isElectron } from '@/lib/electron-env';
import { DESKTOP_ENDPOINT_TOOL_DEFINITIONS } from './desktop-tools';
import { EndpointToolConfirmationDialog } from './confirmation-dialog';
import { EndpointToolHost } from './host';
import { EndpointReenrollmentDialog } from './reenrollment-dialog';
import { requestEndpointReenrollment, settleEndpointReenrollment } from './reenrollment-store';
import { WEB_ENDPOINT_TOOL_DEFINITIONS } from './tools';

export function EndpointToolBridge() {
  useEffect(() => {
    const desktop = isElectron();
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
