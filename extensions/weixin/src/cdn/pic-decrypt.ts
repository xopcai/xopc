import { decryptAesEcb } from "./aes-ecb.js";
import { buildCdnDownloadUrl, ENABLE_CDN_URL_FALLBACK } from "./cdn-url.js";
import { logger } from "../util/logger.js";

const IDLE_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 + 16;

async function fetchCdnBytes(url: string, label: string, parent?: AbortSignal): Promise<Buffer> {
  const timeout = new AbortController();
  const signal = parent ? AbortSignal.any([parent, timeout.signal]) : timeout.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => timeout.abort(new Error('Weixin media download stalled')), IDLE_TIMEOUT_MS);
  };
  resetTimer();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) throw new Error(`${label}: CDN download returned HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) throw new Error('Weixin media exceeds the attachment limit');
    reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    resetTimer();
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts, bytes);
      if (!value.length) continue;
      bytes += value.length;
      if (bytes > MAX_DOWNLOAD_BYTES) throw new Error('Weixin media exceeds the attachment limit');
      parts.push(value);
      resetTimer();
    }
  } finally {
    if (timer) clearTimeout(timer);
    timeout.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

/**
 * Parse CDNMedia.aes_key into a raw 16-byte AES key.
 *
 * Two encodings are seen in the wild:
 *   - base64(raw 16 bytes)          → images (aes_key from media field)
 *   - base64(hex string of 16 bytes) → file / voice / video
 *
 * In the second case, base64-decoding yields 32 ASCII hex chars which must
 * then be parsed as hex to recover the actual 16-byte key.
 */
function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  const msg = `${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes`;
  logger.error(msg);
  throw new Error(msg);
}

/**
 * Download and AES-128-ECB decrypt a CDN media file. Returns plaintext Buffer.
 * aesKeyBase64: CDNMedia.aes_key JSON field (see parseAesKey for supported formats).
 */
export async function downloadAndDecryptBuffer(
  encryptedQueryParam: string,
  aesKeyBase64: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64, label);
  let url: string;
  if (fullUrl) {
    url = fullUrl;
  } else if (ENABLE_CDN_URL_FALLBACK) {
    url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  } else {
    throw new Error(`${label}: fullUrl is required (CDN URL fallback is disabled)`);
  }
  const encrypted = await fetchCdnBytes(url, label, signal);
  logger.debug(`${label}: downloaded ${encrypted.byteLength} bytes, decrypting`);
  const decrypted = decryptAesEcb(encrypted, key);
  logger.debug(`${label}: decrypted ${decrypted.length} bytes`);
  return decrypted;
}

/**
 * Download plain (unencrypted) bytes from the CDN. Returns the raw Buffer.
 */
export async function downloadPlainCdnBuffer(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  let url: string;
  if (fullUrl) {
    url = fullUrl;
  } else if (ENABLE_CDN_URL_FALLBACK) {
    url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  } else {
    throw new Error(`${label}: fullUrl is required (CDN URL fallback is disabled)`);
  }
  return fetchCdnBytes(url, label, signal);
}
