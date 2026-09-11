import { runWithTabSiteAccess } from './page-context';

const MAX_BROWSER_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export const MAX_BROWSER_ATTACHMENTS = 5;

const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/csv',
  'text/csv',
  'text/markdown',
  'text/plain',
]);
const SUPPORTED_DOCUMENT_EXTENSIONS = ['.csv', '.json', '.md', '.pdf', '.txt'];

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
    throw new Error('Browser attachments must be 6 MiB or smaller');
  }
}

function assertSupportedFile(file: File): void {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mimeType.startsWith('image/')
    || SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType)
    || SUPPORTED_DOCUMENT_EXTENSIONS.some((extension) => name.endsWith(extension))) return;
  throw new Error('Attach an image, PDF, text, Markdown, JSON, or CSV file');
}

export async function fileToBrowserAttachment(file: File): Promise<BrowserAttachment> {
  assertSupportedFile(file);
  assertSize(file.size);
  const mimeType = file.type || 'application/octet-stream';
  return {
    type: mimeType.startsWith('image/') ? 'image' : 'file',
    mimeType,
    data: encodeBase64(new Uint8Array(await file.arrayBuffer())),
    name: file.name,
    size: file.size,
  };
}

export async function captureVisibleScreenshot(): Promise<BrowserAttachment> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab.id === undefined) throw new Error('No active web page');
  const dataUrl = await runWithTabSiteAccess(activeTab.id, async (accessibleTab) => {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab.id !== accessibleTab.id) throw new Error('The active tab changed. Try the screenshot again.');
    return chrome.tabs.captureVisibleTab(accessibleTab.windowId, { format: 'png' });
  });
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Chrome returned an invalid screenshot');
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
