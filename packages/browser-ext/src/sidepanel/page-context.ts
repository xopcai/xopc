import {
  MAX_BROWSER_PAGE_TEXT_BYTES,
  MAX_BROWSER_SELECTION_BYTES,
  type BrowserPageContextInput,
} from '@xopcai/gateway-contract';

import { t } from '../i18n';

export type CaptureMode = 'page' | 'selection';
export const PENDING_CONTEXT_KEY = 'xopc.browser.pending-context';
export const TAB_BINDING_PREFIX = 'xopc.browser.tab-binding.';

export type AttachedPageContext = {
  context: BrowserPageContextInput;
  tabId: number;
  source: 'current_page' | 'current_selection' | 'tab_mention';
  stale?: boolean;
};

type RawPageSnapshot = {
  title: string;
  url: string;
  timeOrigin: number;
  selection?: string;
  text?: string;
};

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return { value, truncated: false };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return { value: value.slice(0, low), truncated: true };
}

function sanitizedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(t('errorInvalidWebAddress'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(t('errorRestrictedPage'));
  }
  if (url.hostname === 'chromewebstore.google.com'
    || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))) {
    throw new Error(t('errorWebStorePage'));
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}

type AccessibleTab = chrome.tabs.Tab & { id: number; url: string; windowId: number };

function siteAccessError(cause: unknown, url: string): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  const hostname = new URL(url).hostname;
  if (/cannot access|cannot be scripted|missing host permission|extensions gallery|chrome web store/i.test(message)) {
    return new Error(t('errorSiteAccessBlocked', hostname));
  }
  return cause instanceof Error ? cause : new Error(message);
}

export async function runWithTabSiteAccess<T>(
  tabId: number,
  operation: (tab: AccessibleTab) => Promise<T>,
): Promise<T> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.id === undefined || tab.windowId === undefined || !tab.url) {
    throw new Error(t('errorTabUnavailable'));
  }
  const url = sanitizedUrl(tab.url);
  const originPattern = `${new URL(url).origin}/*`;
  const alreadyGranted = await chrome.permissions.contains({ origins: [originPattern] });
  let newlyGranted = false;

  if (!alreadyGranted) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [originPattern] });
    } catch (cause) {
      throw siteAccessError(cause, url);
    }
    if (!granted) throw new Error(t('errorSiteAccessRequired', new URL(url).hostname));
    newlyGranted = true;
  }

  try {
    return await operation({ ...tab, id: tab.id, windowId: tab.windowId, url });
  } catch (cause) {
    if (newlyGranted) await chrome.permissions.remove({ origins: [originPattern] }).catch(() => false);
    throw siteAccessError(cause, url);
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function extractPage(
  mode: CaptureMode,
  messages: { selectText: string; noReadableContent: string },
): RawPageSnapshot {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const selection = normalize(window.getSelection()?.toString() ?? '');
  if (mode === 'selection') {
    if (!selection) throw new Error(messages.selectText);
    return { title: document.title, url: location.href, timeOrigin: performance.timeOrigin, selection };
  }

  const source = document.querySelector('article, main') ?? document.body;
  if (!source) throw new Error(messages.noReadableContent);
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll([
    'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
    'video', 'audio', 'nav', 'aside', 'header', 'footer', 'form',
    '[hidden]', '[aria-hidden="true"]', '[inert]',
  ].join(',')).forEach((element) => element.remove());
  const text = normalize(clone.innerText || clone.textContent || '');
  if (!text) throw new Error(messages.noReadableContent);
  return { title: document.title, url: location.href, timeOrigin: performance.timeOrigin, text };
}

export async function captureTabPage(tabId: number, mode: CaptureMode): Promise<BrowserPageContextInput> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error(t('errorTabUnavailable'));
  sanitizedUrl(tab.url);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPage,
    args: [mode, {
      selectText: t('errorSelectText'),
      noReadableContent: t('errorNoReadableContent'),
    }],
  });
  const raw = result[0]?.result as RawPageSnapshot | undefined;
  if (!raw) throw new Error(t('errorReadPage'));
  const url = sanitizedUrl(raw.url);
  if (new URL(url).origin !== new URL(sanitizedUrl(tab.url)).origin) {
    throw new Error(t('errorPageChangedReading'));
  }
  const selected = raw.selection
    ? truncateUtf8(raw.selection, MAX_BROWSER_SELECTION_BYTES)
    : undefined;
  const page = raw.text ? truncateUtf8(raw.text, MAX_BROWSER_PAGE_TEXT_BYTES) : undefined;
  const canonical = {
    title: raw.title.trim() || new URL(url).hostname,
    url,
    capturedAt: Date.now(),
    documentId: await sha256(`${url}\n${raw.timeOrigin}`),
    selection: selected?.value,
    text: page?.value,
  };
  return {
    kind: 'browser_page',
    sourceId: crypto.randomUUID(),
    version: await sha256(JSON.stringify(canonical)),
    ...canonical,
    truncated: selected?.truncated === true || page?.truncated === true,
  };
}

export async function captureTabWithPermission(
  tabId: number,
  mode: CaptureMode,
): Promise<BrowserPageContextInput> {
  return runWithTabSiteAccess(tabId, () => captureTabPage(tabId, mode));
}

export async function activeTabId(): Promise<number | undefined> {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

export async function currentTabDescriptor(): Promise<{
  tabId: string;
  windowId: string;
  documentId: string;
  urlOrigin: string;
}> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.id === undefined || tab.windowId === undefined || !tab.url) throw new Error(t('errorNoActivePage'));
  return runWithTabSiteAccess(tab.id, async (accessibleTab) => {
    const result = await chrome.scripting.executeScript({
      target: { tabId: accessibleTab.id },
      func: () => ({ url: location.href, timeOrigin: performance.timeOrigin }),
    });
    const marker = result[0]?.result;
    if (!marker) throw new Error(t('errorIdentifyPage'));
    const currentUrl = sanitizedUrl(marker.url);
    if (new URL(currentUrl).origin !== new URL(accessibleTab.url).origin) {
      throw new Error(t('errorPageChangedConnecting'));
    }
    return {
      tabId: String(accessibleTab.id),
      windowId: String(accessibleTab.windowId),
      documentId: await sha256(`${currentUrl}\n${marker.timeOrigin}`),
      urlOrigin: new URL(currentUrl).origin,
    };
  });
}
