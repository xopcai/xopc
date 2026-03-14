// ========== Helper Functions for Gateway Chat ==========

import type { ChatPayload } from './gateway-types';

/** Get the base URL - always uses current origin. */
export function getBaseUrl(): string {
  return window.location.origin;
}

/** Build an HTTP URL from the path. */
export function apiUrl(path: string): string {
  return `${getBaseUrl()}${path}`;
}

export function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

/** Parse SSE event data from the server */
export function parseSSEEvent(event: MessageEvent): ChatPayload | null {
  try {
    const parsed = JSON.parse(event.data);
    return parsed as ChatPayload;
  } catch {
    return null;
  }
}
