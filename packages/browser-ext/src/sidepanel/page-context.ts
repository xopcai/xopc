import {
  MAX_BROWSER_PAGE_TEXT_BYTES,
  MAX_BROWSER_SELECTION_BYTES,
  type BrowserPageContextInput,
} from '@xopcai/gateway-contract';

export type CaptureMode = 'page' | 'selection';
export const PENDING_CONTEXT_KEY = 'xopc.browser.pending-context';
export const TAB_BINDING_PREFIX = 'xopc.browser.tab-binding.';

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
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('This page cannot be attached');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function extractPage(mode: CaptureMode): RawPageSnapshot {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const selection = normalize(window.getSelection()?.toString() ?? '');
  if (mode === 'selection') {
    if (!selection) throw new Error('Select text on the page first');
    return { title: document.title, url: location.href, timeOrigin: performance.timeOrigin, selection };
  }

  const source = document.querySelector('article, main') ?? document.body;
  if (!source) throw new Error('This page has no readable content');
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll([
    'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
    'video', 'audio', 'nav', 'aside', 'header', 'footer', 'form',
    '[hidden]', '[aria-hidden="true"]', '[inert]',
  ].join(',')).forEach((element) => element.remove());
  const text = normalize(clone.innerText || clone.textContent || '');
  if (!text) throw new Error('This page has no readable content');
  return { title: document.title, url: location.href, timeOrigin: performance.timeOrigin, text };
}

export async function captureCurrentPage(mode: CaptureMode): Promise<BrowserPageContextInput> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id || !tab.url) throw new Error('No active web page');
  sanitizedUrl(tab.url);
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPage,
    args: [mode],
  });
  const raw = result[0]?.result as RawPageSnapshot | undefined;
  if (!raw) throw new Error('Could not read this page');
  const url = sanitizedUrl(raw.url);
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
  if (tab.id === undefined || tab.windowId === undefined || !tab.url) throw new Error('No active web page');
  const url = sanitizedUrl(tab.url);
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ url: location.href, timeOrigin: performance.timeOrigin }),
  });
  const marker = result[0]?.result;
  if (!marker) throw new Error('Could not identify this page');
  const currentUrl = sanitizedUrl(marker.url);
  return {
    tabId: String(tab.id),
    windowId: String(tab.windowId),
    documentId: await sha256(`${currentUrl}\n${marker.timeOrigin}`),
    urlOrigin: new URL(currentUrl).origin,
  };
}
