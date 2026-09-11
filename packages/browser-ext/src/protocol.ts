export type {
  BrowserActionInput,
  BrowserControlResult,
  BrowserExtensionStatus,
  BrowserWireAuthenticate,
  BrowserWireChallenge,
  BrowserNode,
  BrowserObservation,
  BrowserTab,
  BrowserWireCommand,
  BrowserWireKeepAlive,
  BrowserWireResult,
} from '@xopcai/browser-control-contract';
export {
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  browserWireAuthenticationPayload,
} from '@xopcai/browser-control-contract';

export const WS_RECONNECT_BASE_DELAY = 2_000;
export const WS_RECONNECT_MAX_DELAY = 5_000;
export const WS_KEEPALIVE_INTERVAL = 20_000;
export const WS_WATCHDOG_ALARM = 'xopc-ws-watchdog';
export const WS_WATCHDOG_PERIOD_MINUTES = 0.5;
