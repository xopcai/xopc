import { createDesktopEndpointToolDefinitions } from '@xopcai/endpoint-tools-client/desktop-tools';

export const DESKTOP_ENDPOINT_TOOL_DEFINITIONS = createDesktopEndpointToolDefinitions(() => {
  if (!window.electronAPI) throw new Error('Desktop bridge is unavailable');
  return { ...window.electronAPI, device: { readState: async () => ({
    platform: window.electronAPI!.platform, systemVersion: '', locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }) } };
});
