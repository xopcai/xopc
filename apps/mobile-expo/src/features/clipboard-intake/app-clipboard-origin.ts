import { hashClipboardText } from './clipboard-hash';
import { getLatestAppClipboardHash, rememberLatestAppClipboardHash } from './clipboard-intake-store';

export function rememberAppClipboardText(text: string): void {
  const trimmed = text.trim();
  rememberLatestAppClipboardHash(trimmed ? hashClipboardText(trimmed) : null);
}

export function isLatestAppClipboardHash(hash: string): boolean {
  const latestAppClipboardHash = getLatestAppClipboardHash();
  return Boolean(latestAppClipboardHash) && latestAppClipboardHash === hash;
}

