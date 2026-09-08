import { executeBrowserCommand } from './controller';
import { createLogger } from './logger';
import type { BrowserExtensionStatus, BrowserWireCommand, BrowserWireKeepAlive } from './protocol';
import {
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  WS_KEEPALIVE_INTERVAL,
  WS_RECONNECT_BASE_DELAY,
  WS_RECONNECT_MAX_DELAY,
  WS_WATCHDOG_ALARM,
  WS_WATCHDOG_PERIOD_MINUTES,
  XOPC_EXT_WS_URL,
} from './protocol';
import { automationSessions, closeAllSessions } from './session-manager';

const log = createLogger('Background');
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = WS_RECONNECT_BASE_DELAY;
let intentionalClose = false;

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  intentionalClose = false;
  const socket = new WebSocket(XOPC_EXT_WS_URL);
  ws = socket;
  socket.onopen = () => {
    if (ws !== socket) {
      socket.close();
      return;
    }
    reconnectDelay = WS_RECONNECT_BASE_DELAY;
    sendStatus();
    startKeepAlive();
    log.info('Connected to xopc daemon');
  };
  socket.onmessage = async (event) => {
    if (ws !== socket) return;
    try {
      const command = JSON.parse(String(event.data)) as BrowserWireCommand;
      const result = await executeBrowserCommand(command);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(result));
    } catch (error) {
      log.error('Failed to process browser command', { error: error instanceof Error ? error.message : String(error) });
    }
  };
  socket.onclose = (event) => {
    if (ws !== socket) return;
    stopKeepAlive();
    ws = null;
    log.warn('Disconnected from xopc daemon', { code: event.code, reason: event.reason, wasClean: event.wasClean });
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

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (ws?.readyState !== WebSocket.OPEN) {
      stopKeepAlive();
      return;
    }
    const message: BrowserWireKeepAlive = { type: 'keepalive', timestamp: Date.now() };
    ws.send(JSON.stringify(message));
  }, WS_KEEPALIVE_INTERVAL);
}

function stopKeepAlive(): void {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
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
  stopKeepAlive();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  ws?.close();
  ws = null;
}

chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === 'popup/get-status') sendResponse({ connected: ws?.readyState === WebSocket.OPEN, url: XOPC_EXT_WS_URL });
  else if (message.type === 'popup/connect') { connect(); sendResponse({ ok: true }); }
  else if (message.type === 'popup/disconnect') { disconnect(); sendResponse({ ok: true }); }
  else sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
  return true;
});

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WS_WATCHDOG_ALARM && !intentionalClose) connect();
});
void chrome.alarms.create(WS_WATCHDOG_ALARM, { periodInMinutes: WS_WATCHDOG_PERIOD_MINUTES });
connect();

self.addEventListener('beforeunload', () => {
  disconnect();
  void closeAllSessions();
});
