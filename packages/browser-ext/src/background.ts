/**
 * xopc Browser Bridge — Service Worker (background script).
 *
 * Connects to the local xopc daemon via WebSocket, dispatches
 * commands to handler modules, manages lifecycle.
 */

import type { ExtensionCommand, ExtensionResult, StatusEvent } from './protocol';
import {
  XOPC_EXT_WS_URL,
  WS_RECONNECT_BASE_DELAY,
  WS_RECONNECT_MAX_DELAY,
} from './protocol';
import { createLogger } from './logger';
import { automationSessions, closeAllSessions, DEFAULT_WORKSPACE } from './session-manager';

// Handler imports
import { handleOpen, handleNavigate, handleReload, handleBack, handleForward, handleGetUrl, handleGetTitle } from './handlers/navigation';
import { handleMouseMove, handleMouseClick, handleMouseWheel, handleKeyboardPress, handleKeyboardType, handleType } from './handlers/input';
import { handleClick, handleScroll, handleEvaluate, handleWait, handleQuerySelector } from './handlers/elements';
import { handleState, handleSnapshot, handleScreenshot, handleGetViewportSize, handleSetViewportSize, handleClose, handleNewTab, handleListTabs, handleGetCookies, handleDialog } from './handlers/page';

const log = createLogger('Background');

// ── WebSocket state ──────────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = WS_RECONNECT_BASE_DELAY;
let intentionalClose = false;

// ── Command dispatch ─────────────────────────────────────────────────

async function dispatchCommand(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const start = Date.now();

  try {
    let result: ExtensionResult;

    switch (cmd.action) {
      // Navigation
      case 'open': result = await handleOpen(cmd); break;
      case 'navigate': result = await handleNavigate(cmd); break;
      case 'reload': result = await handleReload(cmd); break;
      case 'back': result = await handleBack(cmd); break;
      case 'forward': result = await handleForward(cmd); break;
      case 'get_url': result = await handleGetUrl(cmd); break;
      case 'get_title': result = await handleGetTitle(cmd); break;

      // Page
      case 'state': result = await handleState(cmd); break;
      case 'snapshot': result = await handleSnapshot(cmd); break;
      case 'screenshot': result = await handleScreenshot(cmd); break;
      case 'get_viewport_size': result = await handleGetViewportSize(cmd); break;
      case 'set_viewport_size': result = await handleSetViewportSize(cmd); break;
      case 'close': result = await handleClose(cmd); break;
      case 'new_tab': result = await handleNewTab(cmd); break;
      case 'list_tabs': result = await handleListTabs(cmd); break;
      case 'get_cookies': result = await handleGetCookies(cmd); break;
      case 'dialog': result = await handleDialog(cmd); break;

      // Elements
      case 'click': result = await handleClick(cmd); break;
      case 'scroll': result = await handleScroll(cmd); break;
      case 'evaluate': result = await handleEvaluate(cmd); break;
      case 'wait': result = await handleWait(cmd); break;
      case 'query_selector': result = await handleQuerySelector(cmd); break;

      // Input
      case 'mouse_move': result = await handleMouseMove(cmd); break;
      case 'mouse_click': result = await handleMouseClick(cmd); break;
      case 'mouse_wheel': result = await handleMouseWheel(cmd); break;
      case 'keys': result = await handleKeyboardPress(cmd); break;
      case 'keyboard_type': result = await handleKeyboardType(cmd); break;
      case 'type': result = await handleType(cmd); break;

      // Ping
      case 'ping':
        result = { id: cmd.id, ok: true, data: { pong: true, timestamp: Date.now() } };
        break;

      default:
        result = { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }

    result.durationMs = Date.now() - start;
    return result;
  } catch (e) {
    return {
      id: cmd.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

// ── WebSocket connection ─────────────────────────────────────────────

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  intentionalClose = false;
  log.info('Connecting to xopc daemon...', { url: XOPC_EXT_WS_URL });

  ws = new WebSocket(XOPC_EXT_WS_URL);

  ws.onopen = () => {
    log.info('Connected to xopc daemon');
    reconnectDelay = WS_RECONNECT_BASE_DELAY;
    sendStatus();
  };

  ws.onmessage = async (event) => {
    try {
      const cmd = JSON.parse(event.data as string) as ExtensionCommand;
      log.debug('Received command', { action: cmd.action, id: cmd.id });

      const result = await dispatchCommand(cmd);
      ws?.send(JSON.stringify(result));
    } catch (e) {
      log.error('Failed to process message', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  ws.onclose = () => {
    ws = null;
    if (!intentionalClose) {
      log.warn('Disconnected, reconnecting...', { delay: reconnectDelay });
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

// ── Status reporting ─────────────────────────────────────────────────

async function sendStatus(): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  try {
    // Do not create tabs/groups here — install/connect must not open UI.
    const sess = automationSessions.get(DEFAULT_WORKSPACE);
    let activeTabId: number | undefined;
    let activeUrl: string | undefined;
    if (sess?.activeTabId != null) {
      const tab = await chrome.tabs.get(sess.activeTabId).catch(() => null);
      if (tab) {
        activeTabId = tab.id;
        activeUrl = tab.url;
      }
    }

    const status: StatusEvent = {
      type: 'status',
      connected: true,
      tabCount: sess ? sess.tabIds.length : 0,
      activeTabId,
      activeUrl,
    };

    ws.send(JSON.stringify(status));
  } catch {
    // best effort
  }
}

// ── Popup / internal messaging ───────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: { type: string; [key: string]: unknown }, _sender, sendResponse) => {
    switch (message.type) {
      case 'popup/get-status':
        sendResponse({
          connected: ws?.readyState === WebSocket.OPEN,
          url: XOPC_EXT_WS_URL,
        });
        break;
      case 'popup/connect':
        connect();
        sendResponse({ ok: true });
        break;
      case 'popup/disconnect':
        disconnect();
        sendResponse({ ok: true });
        break;
      case 'content/heartbeat':
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
    }
    return true;
  },
);

// ── Lifecycle ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  log.info('Extension installed/updated');
  connect();
});

chrome.runtime.onStartup.addListener(() => {
  log.info('Browser started');
  connect();
});

// Auto-connect on load
connect();

// Cleanup on suspend (MV3 service worker can be terminated)
self.addEventListener('beforeunload', () => {
  disconnect();
  void closeAllSessions();
});

log.info('xopc Browser Bridge service worker loaded');
