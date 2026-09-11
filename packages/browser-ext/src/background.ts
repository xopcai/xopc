import { executeBrowserCommand } from './controller';
import { createLogger } from './logger';
import type {
  BrowserExtensionStatus,
  BrowserWireAuthenticate,
  BrowserWireChallenge,
  BrowserWireCommand,
  BrowserWireKeepAlive,
} from './protocol';
import {
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  browserWireAuthenticationPayload,
  WS_KEEPALIVE_INTERVAL,
  WS_RECONNECT_BASE_DELAY,
  WS_RECONNECT_MAX_DELAY,
  WS_WATCHDOG_ALARM,
  WS_WATCHDOG_PERIOD_MINUTES,
  XOPC_EXT_WS_URL,
} from './protocol';
import { automationSessions } from './session-manager';
import { readProfile, signBrowserBridgeChallenge } from './sidepanel/auth';
import { captureCurrentPage, PENDING_CONTEXT_KEY } from './sidepanel/page-context';

const log = createLogger('Background');
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = WS_RECONNECT_BASE_DELAY;
let intentionalClose = false;
let authenticatedConnectionId: string | null = null;

async function authenticate(socket: WebSocket, challenge: BrowserWireChallenge): Promise<void> {
  if (challenge.protocolVersion !== BROWSER_EXTENSION_PROTOCOL_VERSION) {
    socket.close(4406, 'Browser protocol mismatch');
    return;
  }
  const profile = await readProfile();
  if (!profile) {
    socket.close(4401, 'Browser is not paired');
    return;
  }
  const extensionVersion = chrome.runtime.getManifest().version;
  const unsigned = {
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    connectionId: challenge.connectionId,
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    principalId: profile.deviceId,
    extensionId: chrome.runtime.id,
    extensionVersion,
  } as const;
  const message: BrowserWireAuthenticate = {
    type: 'authenticate',
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    connectionId: challenge.connectionId,
    principalId: profile.deviceId,
    extensionId: chrome.runtime.id,
    extensionVersion,
    signature: await signBrowserBridgeChallenge(browserWireAuthenticationPayload(unsigned)),
  };
  socket.send(JSON.stringify(message));
  authenticatedConnectionId = challenge.connectionId;
  sendStatus(profile.deviceId);
  startKeepAlive();
}

async function connect(): Promise<void> {
  if (!await readProfile()) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  intentionalClose = false;
  authenticatedConnectionId = null;
  const socket = new WebSocket(XOPC_EXT_WS_URL);
  ws = socket;
  socket.onopen = () => {
    if (ws !== socket) socket.close();
  };
  socket.onmessage = async (event) => {
    if (ws !== socket) return;
    try {
      const value = JSON.parse(String(event.data)) as { type?: unknown; connectionId?: unknown };
      if (value.type === 'auth_challenge') {
        await authenticate(socket, value as BrowserWireChallenge);
        reconnectDelay = WS_RECONNECT_BASE_DELAY;
        log.info('Authenticated with xopc browser bridge');
        return;
      }
      if (!authenticatedConnectionId || value.connectionId !== authenticatedConnectionId) {
        throw new Error('Browser command arrived before authentication or for a stale connection');
      }
      const result = await executeBrowserCommand(value as BrowserWireCommand);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(result));
    } catch (error) {
      log.error('Failed to process browser bridge message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  socket.onclose = (event) => {
    if (ws !== socket) return;
    stopKeepAlive();
    ws = null;
    authenticatedConnectionId = null;
    log.warn('Disconnected from xopc browser bridge', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
    if (!intentionalClose && event.code !== 4401) scheduleReconnect();
  };
}

function sendStatus(principalId: string): void {
  if (ws?.readyState !== WebSocket.OPEN || !authenticatedConnectionId) return;
  const status: BrowserExtensionStatus = {
    type: 'status',
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    connectionId: authenticatedConnectionId,
    principalId,
    connected: true,
    sessionCount: automationSessions.size,
  };
  ws.send(JSON.stringify(status));
}

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (ws?.readyState !== WebSocket.OPEN || !authenticatedConnectionId) {
      stopKeepAlive();
      return;
    }
    const message: BrowserWireKeepAlive = {
      type: 'keepalive',
      connectionId: authenticatedConnectionId,
      timestamp: Date.now(),
    };
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
    void connect();
  }, reconnectDelay);
}

function disconnect(): void {
  intentionalClose = true;
  stopKeepAlive();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  ws?.close();
  ws = null;
  authenticatedConnectionId = null;
}

chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === 'browser/get-status') {
    sendResponse({ connected: Boolean(authenticatedConnectionId), url: XOPC_EXT_WS_URL });
  } else if (message.type === 'browser/reconnect') {
    disconnect();
    intentionalClose = false;
    void connect();
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
  }
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'xopc-ask-selection' || !tab?.id) return;
  void captureCurrentPage('selection').then(async (context) => {
    await chrome.storage.session.set({ [PENDING_CONTEXT_KEY]: context });
    await chrome.sidePanel.open({ tabId: tab.id! });
  }).catch((error) => log.warn('Could not attach selected page text', {
    error: error instanceof Error ? error.message : String(error),
  }));
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'xopc-ask-selection',
      title: 'Ask xopc about “%s”',
      contexts: ['selection'],
    });
  });
  void connect();
});
chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['xopc.browser.profile']) {
    disconnect();
    intentionalClose = false;
    void connect();
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WS_WATCHDOG_ALARM && !intentionalClose) void connect();
});
void chrome.alarms.create(WS_WATCHDOG_ALARM, { periodInMinutes: WS_WATCHDOG_PERIOD_MINUTES });
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
void connect();
