import { useEffect } from 'react';

import { isElectron } from '@/lib/electron-env';
import { DESKTOP_ENDPOINT_TOOLS, executeDesktopEndpointTool } from './desktop-tools';
import { EndpointToolConfirmationDialog } from './confirmation-dialog';
import { EndpointToolHost } from './host';
import { EndpointReenrollmentDialog } from './reenrollment-dialog';
import { requestEndpointReenrollment, settleEndpointReenrollment } from './reenrollment-store';
import { executeWebEndpointTool, WEB_ENDPOINT_TOOLS } from './tools';

export function EndpointToolBridge() {
  useEffect(() => {
    const desktop = isElectron();
    const host = new EndpointToolHost(desktop ? {
      kind: 'desktop',
      platform: window.electronAPI?.platform ?? 'desktop',
      displayName: 'xopc Desktop',
      appVersion: '1',
      tools: DESKTOP_ENDPOINT_TOOLS,
      execute: executeDesktopEndpointTool,
      confirmReenrollment: requestEndpointReenrollment,
    } : {
      kind: 'web',
      platform: 'web',
      displayName: 'Web browser',
      appVersion: '1',
      tools: WEB_ENDPOINT_TOOLS,
      execute: executeWebEndpointTool,
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
