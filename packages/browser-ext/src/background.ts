import {
  BROWSER_CONTROL_ENDPOINT_DESCRIPTOR,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  type BrowserActionInput,
} from '@xopcai/browser-control-contract';
import {
  EndpointToolHostController,
  EndpointToolRegistry,
} from '@xopcai/endpoint-tools-client';
import type { EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';

import { executeBrowserCommand } from './controller';
import { createLogger } from './logger';
import {
  createBrowserEndpointHello,
  gatewayFetch,
  getAccessProfile,
  readProfile,
  registerBrowserEndpoint,
} from './sidepanel/auth';
import { captureTabWithPermission, PENDING_CONTEXT_KEY } from './sidepanel/page-context';

const log = createLogger('Background');
const BACKGROUND_CLIENT_ID_KEY = 'xopc.browser.background-client-id';
let realtime: RealtimeClient | undefined;
let endpointClaim: { endpointId: string; token: string } | undefined;
let lastConnectionError: string | undefined;
let connectTask: Promise<void> | undefined;
let connectionGeneration = 0;

const browserToolRegistry = new EndpointToolRegistry([{
  descriptor: BROWSER_CONTROL_ENDPOINT_DESCRIPTOR as unknown as EndpointToolDescriptor,
  execute: async (args) => {
    const input = args.input;
    if (!input || typeof input !== 'object') throw new TypeError('Browser control input is required');
    const result = await executeBrowserCommand({
      id: crypto.randomUUID(),
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      connectionId: 'gateway-realtime',
      input: input as BrowserActionInput,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 30_000,
      visualFallback: args.visualFallback !== false,
    });
    return { content: [{ type: 'json', value: result.result }] };
  },
}]);

const endpointHost = new EndpointToolHostController({
  registry: browserToolRegistry,
  getAvailability: () => 'background',
  confirm: async () => false,
  uploadFile: async () => { throw new Error('Browser control does not upload endpoint files'); },
  createMessageId: () => crypto.randomUUID(),
});

async function backgroundClientId(): Promise<string> {
  const stored = await chrome.storage.local.get(BACKGROUND_CLIENT_ID_KEY);
  if (typeof stored[BACKGROUND_CLIENT_ID_KEY] === 'string') return stored[BACKGROUND_CLIENT_ID_KEY];
  const value = crypto.randomUUID();
  await chrome.storage.local.set({ [BACKGROUND_CLIENT_ID_KEY]: value });
  return value;
}

async function connect(generation: number): Promise<void> {
  if (realtime || !await readProfile()) return;
  await registerBrowserEndpoint();
  const profile = await getAccessProfile();
  const id = await backgroundClientId();
  const client = new RealtimeClient({
    clientId: id,
    clientKind: 'browser_extension',
    getWebSocketUrl: () => {
      const url = new URL(profile.gatewayUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/api/realtime/v1/ws';
      url.search = '';
      url.hash = '';
      return url.toString();
    },
    issueTicket: async (signal) => {
      const response = await gatewayFetch('/api/realtime/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: id, clientKind: 'browser_extension' }),
        signal,
      });
      const body = await response.json() as { payload?: { ticket?: string } };
      if (!response.ok || !body.payload?.ticket) throw new Error(`Realtime ticket failed (${response.status})`);
      return body.payload.ticket;
    },
    createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
    onStateChange: (state, error) => {
      lastConnectionError = error;
      if (state === 'connected') lastConnectionError = undefined;
      if (error) log.warn('Browser Realtime connection changed', { state, error });
    },
  });
  client.setEndpoint({
    createHello: () => createBrowserEndpointHello(browserToolRegistry.descriptors()),
    onReady: ({ endpointId, turnToken }) => {
      endpointClaim = { endpointId, token: turnToken };
      lastConnectionError = undefined;
      endpointHost.connect((message) => client.sendEndpointMessage(message));
      void chrome.runtime.sendMessage({ type: 'browser/endpoint-ready', claim: endpointClaim }).catch(() => undefined);
      log.info('Browser control connected through Gateway Realtime', { endpointId });
    },
    onMessage: (message) => { void endpointHost.handleMessage(message); },
    onDisconnected: () => {
      endpointClaim = undefined;
      endpointHost.disconnect();
    },
  });
  if (generation !== connectionGeneration || realtime) return;
  realtime = client;
  client.connect();
}

function disconnect(): void {
  connectionGeneration += 1;
  realtime?.disconnect();
  realtime = undefined;
  endpointClaim = undefined;
  endpointHost.disconnect();
}

function connectWithLogging(): void {
  if (connectTask) return;
  const generation = connectionGeneration;
  connectTask = connect(generation)
    .catch((error) => {
      lastConnectionError = error instanceof Error ? error.message : String(error);
      log.warn('Could not connect browser Realtime transport', { error: lastConnectionError });
    })
    .finally(() => {
      connectTask = undefined;
      if (generation !== connectionGeneration && !realtime) connectWithLogging();
    });
}

chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === 'browser/get-status') {
    sendResponse({ connected: Boolean(endpointClaim), transport: 'gateway-realtime', error: lastConnectionError });
  } else if (message.type === 'browser/get-endpoint-claim') {
    sendResponse({ claim: endpointClaim, error: lastConnectionError });
  } else if (message.type === 'browser/reconnect') {
    disconnect();
    connectWithLogging();
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
  }
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'xopc-ask-selection' || !tab?.id) return;
  const tabId = tab.id;
  void captureTabWithPermission(tabId, 'selection').then(async (context) => {
    await chrome.storage.session.set({
      [PENDING_CONTEXT_KEY]: { context, tabId, source: 'current_selection' },
    });
    await chrome.sidePanel.open({ tabId });
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
  connectWithLogging();
});
chrome.runtime.onStartup.addListener(connectWithLogging);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['xopc.browser.profile']) {
    disconnect();
    connectWithLogging();
  }
});
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
connectWithLogging();
