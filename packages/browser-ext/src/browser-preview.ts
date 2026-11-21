import type { BrowserActionInput } from '@xopcai/browser-control-contract';
import {
  BROWSER_PREVIEW_LEASE_MS,
  type BrowserPreviewClientMessage,
  type BrowserPreviewServerMessage,
} from '@xopcai/realtime-protocol';

import { startPreviewDocument, type PreviewDocumentMessage } from './preview-document';
import { automationSessions } from './session-manager';
import { gatewayFetch } from './sidepanel/auth';

type PreviewRequest = Extract<BrowserPreviewServerMessage, { type: 'requested' }>;
type Viewer = PreviewRequest & { verified?: true; active?: true; snapshot?: string; uploading?: boolean };

const CAPTURE_START_TIMEOUT_MS = 5_000;

export function installBrowserPreview(send: (message: BrowserPreviewClientMessage) => void) {
  if (!chrome.action?.onClicked || !chrome.runtime.onConnect) return;
  const viewers = new Map<string, Viewer>();
  let target: PreviewRequest | undefined;
  let documentId: string | undefined;
  let publisher: chrome.runtime.Port | undefined;
  let captureId: string | undefined;
  let captureTimeout: ReturnType<typeof setTimeout> | undefined;
  let captureReady = false;

  function notify(message: BrowserPreviewClientMessage): void {
    try { send(message); } catch { /* Document leases expire without signaling. */ }
  }

  function updateToolbar(): void {
    const tabId = target?.tabId;
    if (tabId === undefined) return;
    const sharing = captureReady && viewers.size > 0;
    const ready = [...viewers.values()].some(viewer => viewer.verified);
    const zh = chrome.i18n.getUILanguage().startsWith('zh');
    const title = sharing ? (zh ? '查看或停止浏览器共享' : 'View or stop browser sharing')
      : ready ? (zh ? '点击开始共享任务标签' : 'Click to start sharing the task tab')
        : chrome.i18n.getMessage('appName') || 'xopc';
    void chrome.action.setTitle({ tabId, title }).catch(() => {});
    void chrome.action.setBadgeText({ tabId, text: sharing ? '●' : ready ? '▶' : '' }).catch(() => {});
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sharing || !ready }).catch(() => {});
  }

  function clear(inform: boolean): void {
    const ids = [...viewers.keys()];
    viewers.clear();
    clearTimeout(captureTimeout);
    captureTimeout = undefined;
    captureReady = false;
    updateToolbar();
    target = undefined;
    documentId = undefined;
    captureId = undefined;
    const port = publisher;
    publisher = undefined;
    port?.disconnect();
    if (inform) for (const requestId of ids) notify({ type: 'close', requestId });
  }

  function remove(requestId: string, inform: boolean): void {
    if (!viewers.delete(requestId)) return;
    publisher?.postMessage({ type: 'closed', requestId, reason: 'ended' });
    if (inform) notify({ type: 'close', requestId });
    if (!viewers.size) clear(false);
    else updateToolbar();
  }

  function ownsTab(message: PreviewRequest): boolean {
    const session = automationSessions.get(message.browserSessionId);
    return Boolean(session?.activeTabId === message.tabId && session.tabIds.includes(message.tabId));
  }

  async function prepare(message: PreviewRequest): Promise<void> {
    if (!ownsTab(message) || viewers.size >= 2 || (target && (target.conversationId !== message.conversationId || target.browserSessionId !== message.browserSessionId
      || target.tabId !== message.tabId || target.origin !== message.origin))) {
      notify({ type: 'close', requestId: message.requestId });
      return;
    }
    target ??= message;
    const viewer: Viewer = { ...message };
    viewers.set(message.requestId, viewer);
    try {
      const [frame] = await chrome.scripting.executeScript({ target: documentId
        ? { tabId: message.tabId, documentIds: [documentId] } : { tabId: message.tabId }, func: () => location.origin });
      if (viewers.get(message.requestId) !== viewer) return;
      if (!frame?.documentId || frame.result !== message.origin || !ownsTab(message)) { remove(message.requestId, true); return; }
      if (documentId && frame.documentId !== documentId) { remove(message.requestId, true); return; }
      documentId = frame.documentId;
      viewer.verified = true;
      if (captureReady) accept(viewer);
      else updateToolbar();
    } catch { remove(message.requestId, true); }
  }

  function accept(viewer: Viewer): void {
    if (!publisher || !captureReady || !viewer.verified || viewer.active) return;
    viewer.active = true;
    notify({ type: 'accept', requestId: viewer.requestId });
    updateToolbar();
  }

  chrome.action.onClicked.addListener(tab => {
    const current = target;
    const targetDocument = documentId;
    if (!current || !targetDocument || current.tabId !== tab.id || captureReady) {
      if (tab.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      return;
    }
    if (captureId) return;
    const first = [...viewers.values()].find(viewer => viewer.verified);
    if (!first) return;
    if (!ownsTab(current)) { clear(true); return; }
    captureId = first.requestId;
    clearTimeout(captureTimeout);
    captureTimeout = setTimeout(() => {
      if (target === current && captureId === first.requestId && !captureReady) clear(true);
    }, CAPTURE_START_TIMEOUT_MS);
    chrome.tabCapture.getMediaStreamId({ targetTabId: current.tabId, consumerTabId: current.tabId }, id => {
      if (target !== current || captureId !== first.requestId) return;
      if (!id || chrome.runtime.lastError || !ownsTab(current)) { clear(true); return; }
      void chrome.scripting.executeScript({ target: { tabId: current.tabId, documentIds: [targetDocument] },
        func: startPreviewDocument, args: [first.requestId, id, current.origin, BROWSER_PREVIEW_LEASE_MS] })
        .then(results => {
          if (target === current && captureId === first.requestId && results?.[0]?.result === false) clear(true);
        })
        .catch(() => { if (target === current) clear(true); });
    });
  });

  chrome.tabs?.onRemoved?.addListener(tabId => {
    if (target?.tabId === tabId) clear(true);
  });

  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (target?.tabId !== tabId || !changeInfo.url) return;
    try {
      if (new URL(changeInfo.url).origin !== target.origin) clear(true);
    } catch {
      clear(true);
    }
  });

  async function uploadSnapshot(viewer: Viewer, jpeg: string): Promise<void> {
    const token = viewer.snapshot;
    if (!token || viewer.uploading || jpeg.length > 110_000) return;
    viewer.uploading = true;
    try {
      const body = Uint8Array.from(atob(jpeg), value => value.charCodeAt(0));
      await gatewayFetch(`/api/browser/preview/${viewer.requestId}/snapshot`, {
        method: 'POST', body, headers: { 'Content-Type': 'image/jpeg', 'X-Xopc-Preview': token },
        signal: AbortSignal.timeout(1600),
      });
    } catch { /* A later frame supersedes a failed upload. */ }
    finally { viewer.uploading = false; }
  }

  chrome.runtime.onConnect.addListener(port => {
    const current = target;
    if (!port.name.startsWith('browser-preview:')) return;
    let origin: string | undefined;
    try { origin = new URL(port.sender?.url ?? '').origin; } catch { /* An unknown sender cannot publish. */ }
    if (!current || !captureId || publisher || port.name !== `browser-preview:${captureId}`
      || port.sender?.id !== chrome.runtime.id || port.sender.tab?.id !== current.tabId
      || port.sender.frameId !== 0 || port.sender.documentId !== documentId
      || origin !== current.origin || !ownsTab(current)) {
      port.disconnect();
      return;
    }
    publisher = port;
    port.onDisconnect.addListener(() => { if (publisher === port) clear(true); });
    port.onMessage.addListener((message: PreviewDocumentMessage) => {
      if (publisher !== port || target !== current) return;
      if (message.type === 'ready') {
        clearTimeout(captureTimeout);
        captureTimeout = undefined;
        captureReady = true;
        for (const viewer of viewers.values()) accept(viewer);
        return;
      }
      const viewer = viewers.get(message.requestId);
      if (!viewer?.active) return;
      if (message.type === 'signal') notify({ type: 'signal', requestId: message.requestId, signal: message.signal });
      else if (message.type === 'snapshot') void uploadSnapshot(viewer, message.jpeg);
    });
  });

  return {
    receive(message: BrowserPreviewServerMessage): void {
      if (message.type === 'requested') { void prepare(message); return; }
      const viewer = viewers.get(message.requestId);
      if (!viewer) return;
      if (message.type === 'closed') { remove(message.requestId, false); return; }
      if (!viewer.active) return;
      if (message.type === 'quality') viewer.snapshot = message.snapshotToken;
      publisher?.postMessage(message);
    },
    status: () => {
      if (!target || !documentId) return undefined;
      return {
        origin: target.origin,
        sharing: captureReady,
        viewers: [...viewers.values()]
          .filter(viewer => viewer.verified)
          .map(viewer => ({ requestId: viewer.requestId, viewer: viewer.viewer, active: Boolean(viewer.active) })),
      };
    },
    stop: (requestId?: string) => {
      if (requestId) remove(requestId, true);
      else clear(true);
    },
    clear: () => clear(false),
    async stopBeforeAction(input: BrowserActionInput): Promise<void> {
      if (!target || target.browserSessionId !== input.sessionId
        || !['navigate', 'tabs', 'close', 'fill', 'upload'].includes(input.action)
        || input.action === 'tabs' && input.operation === 'list') return;
      const port = publisher;
      if (!port) { clear(true); return; }
      const current = target;
      try {
        await new Promise<void>((resolve, reject) => {
          const onDisconnect = () => { clearTimeout(deadline); resolve(); };
          const deadline = setTimeout(() => {
            port.onDisconnect.removeListener(onDisconnect);
            if (input.action === 'close') resolve();
            else reject(new Error('Wait for Chrome to stop sharing this browser preview before retrying.'));
          }, 1000);
          port.onDisconnect.addListener(onDisconnect);
          try {
            port.postMessage({ type: 'stop' });
          } catch {
            clearTimeout(deadline);
            port.onDisconnect.removeListener(onDisconnect);
            resolve();
          }
        });
      } finally {
        if (target === current) clear(true);
      }
    },
  };
}
