const MAX_BROWSER_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export const MAX_BROWSER_ATTACHMENTS = 5;

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

export async function fileToBrowserAttachment(file: File): Promise<BrowserAttachment> {
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
  const dataUrl = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
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
