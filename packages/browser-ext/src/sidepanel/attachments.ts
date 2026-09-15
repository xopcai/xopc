import { t } from '../i18n';
import { runWithTabSiteAccess } from './page-context';

const MAX_BROWSER_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const MAX_BROWSER_ATTACHMENTS = 10;

const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/csv',
  'text/csv',
  'text/markdown',
  'text/plain',
]);
const DOCUMENT_MIMES: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  md: 'text/markdown', txt: 'text/plain', html: 'text/html', xml: 'text/xml',
  css: 'text/css', js: 'text/javascript', ts: 'text/plain', jsx: 'text/plain', tsx: 'text/plain',
  yaml: 'text/plain', yml: 'text/plain', py: 'text/plain', sh: 'text/plain', sql: 'text/plain',
};
export const BROWSER_ATTACHMENT_ACCEPT = `image/*,${Object.keys(DOCUMENT_MIMES).map(extension => `.${extension}`).join(',')}`;


export type BrowserAttachment = {
  type: 'image' | 'file';
  mimeType: string;
  data: string;
  name: string;
  size: number;
};

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 32 * 1024;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function assertSize(size: number): void {
  if (size > MAX_BROWSER_ATTACHMENT_BYTES) {
    throw new Error(t('errorAttachmentTooLarge'));
  }
}

function assertSupportedFile(file: File): void {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mimeType.startsWith('image/')
    || SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType)
    || Object.keys(DOCUMENT_MIMES).some((extension) => name.endsWith(`.${extension}`))) return;
  throw new Error(t('errorUnsupportedAttachment'));
}

export async function fileToBrowserAttachment(file: File): Promise<BrowserAttachment> {
  assertSupportedFile(file);
  assertSize(file.size);
  const mimeType = file.type || DOCUMENT_MIMES[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream';
  return {
    type: mimeType.startsWith('image/') ? 'image' : 'file',
    mimeType,
    data: encodeBase64(new Uint8Array(await file.arrayBuffer())),
    name: file.name,
    size: file.size,
  };
}

export async function captureVisibleScreenshot(): Promise<BrowserAttachment> {
  // Site access alone cannot authorize captureVisibleTab. Request while still
  // in the click handler: clicking inside a side panel does not grant activeTab.
  const tabPromise = chrome.tabs.query({ active: true, currentWindow: true });
  const [granted, [activeTab]] = await Promise.all([
    chrome.permissions.request({ origins: ['<all_urls>'] }),
    tabPromise,
  ]);
  if (!granted) throw new Error(t('errorScreenshotPermissionRequired'));
  if (activeTab?.id === undefined) throw new Error(t('errorNoActivePage'));
  const dataUrl = await runWithTabSiteAccess(activeTab.id, async (accessibleTab) => {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab?.id !== accessibleTab.id) throw new Error(t('errorActiveTabChanged'));
    return chrome.tabs.captureVisibleTab(accessibleTab.windowId, { format: 'png' });
  });
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error(t('errorInvalidScreenshot'));
  const data = dataUrl.slice(separator + 1);
  const size = Math.floor(data.length * 3 / 4);
  assertSize(size);
  return {
    type: 'image',
    mimeType: 'image/png',
    data,
    name: `screenshot-${new Date().toISOString().replaceAll(':', '-')}.png`,
    size,
  };
}
