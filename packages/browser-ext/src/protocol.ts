export type {
  BrowserActionInput,
  BrowserControlResult,
  BrowserExtensionStatus,
  BrowserNode,
  BrowserObservation,
  BrowserTab,
  BrowserWireCommand,
  BrowserWireResult,
} from '@xopcai/browser-control-contract';
export { BROWSER_EXTENSION_PROTOCOL_VERSION } from '@xopcai/browser-control-contract';

export const XOPC_EXT_PORT = 19820;
export const XOPC_EXT_HOST = '127.0.0.1';
export const XOPC_EXT_WS_URL = `ws://${XOPC_EXT_HOST}:${XOPC_EXT_PORT}/browser-ext`;
export const WS_RECONNECT_BASE_DELAY = 2_000;
export const WS_RECONNECT_MAX_DELAY = 5_000;
