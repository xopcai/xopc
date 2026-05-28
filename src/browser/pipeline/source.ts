import { readFile } from 'node:fs/promises';

const DEFAULT_PIPELINE_SOURCE_TIMEOUT_MS = 30_000;
const MAX_PIPELINE_SOURCE_BYTES = 1024 * 1024;

export interface BrowserPipelineSource {
  source: string;
  origin: 'file' | 'url';
  location: string;
}

export function isRemotePipelineSource(location: string): boolean {
  try {
    const url = new URL(location);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function readLimitedResponseText(response: Response, url: string): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const expectedBytes = Number.parseInt(contentLength, 10);
    if (Number.isFinite(expectedBytes) && expectedBytes > MAX_PIPELINE_SOURCE_BYTES) {
      throw new Error(`Pipeline URL is too large: ${expectedBytes} bytes`);
    }
  }

  if (!response.body) {
    return await response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PIPELINE_SOURCE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`Pipeline URL is too large: ${url}`);
    }
    chunks.push(value);
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(payload);
}

async function fetchPipelineSource(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/yaml, text/yaml, text/plain, */*',
    },
    signal: AbortSignal.timeout(DEFAULT_PIPELINE_SOURCE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    throw new Error(`Pipeline URL returned HTTP ${response.status}${statusText}`);
  }

  return await readLimitedResponseText(response, url);
}

export async function loadBrowserPipelineSource(location: string): Promise<BrowserPipelineSource> {
  const normalizedLocation = location.trim();
  if (!normalizedLocation) {
    throw new Error('Pipeline path is empty');
  }

  if (isRemotePipelineSource(normalizedLocation)) {
    return {
      source: await fetchPipelineSource(normalizedLocation),
      origin: 'url',
      location: normalizedLocation,
    };
  }

  return {
    source: await readFile(normalizedLocation, 'utf-8'),
    origin: 'file',
    location: normalizedLocation,
  };
}
