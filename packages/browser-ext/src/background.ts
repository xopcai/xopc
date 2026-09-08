import { executeBrowserCommand } from './controller';
import { createLogger } from './logger';
import type { BrowserExtensionStatus, BrowserWireCommand } from './protocol';
import { BROWSER_EXTENSION_PROTOCOL_VERSION, XOPC_EXT_WS_URL, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from './protocol';
import { automationSessions, closeAllSessions } from './session-manager';

const log = createLogger('Background');
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = WS_RECONNECT_BASE_DELAY;
let intentionalClose = false;

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  intentionalClose = false;
  ws = new WebSocket(XOPC_EXT_WS_URL);
  ws.onopen = () => {
    reconnectDelay = WS_RECONNECT_BASE_DELAY;
    sendStatus();
    log.info('Connected to xopc daemon');
  };
  ws.onmessage = async (event) => {
    try {
      const command = JSON.parse(String(event.data)) as BrowserWireCommand;
      const result = await executeBrowserCommand(command);
      ws?.send(JSON.stringify(result));
    } catch (error) {
      log.error('Failed to process browser command', { error: error instanceof Error ? error.message : String(error) });
    }
  };
  ws.onclose = () => {
    ws = null;
    if (!intentionalClose) scheduleReconnect();
  };
}

function sendStatus(): void {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const status: BrowserExtensionStatus = {
    type: 'status',
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    connected: true,
    sessionCount: automationSessions.size,
  };
  ws.send(JSON.stringify(status));
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 1.5, WS_RECONNECT_MAX_DELAY);
    connect();
  }, reconnectDelay);
}

function disconnect(): void {
  intentionalClose = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  ws?.close();
  ws = null;
}

chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === 'popup/get-status') sendResponse({ connected: ws?.readyState === WebSocket.OPEN, url: XOPC_EXT_WS_URL });
  else if (message.type === 'popup/connect') { connect(); sendResponse({ ok: true }); }
  else if (message.type === 'popup/disconnect') { disconnect(); sendResponse({ ok: true }); }
  else if (message.type === 'content/heartbeat') sendResponse({ ok: true });
  else sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
  return true;
});

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
connect();

self.addEventListener('beforeunload', () => {
  disconnect();
  void closeAllSessions();
});
