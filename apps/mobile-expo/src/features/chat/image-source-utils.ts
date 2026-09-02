import type { ImageContent } from './messages.types';
import { buildGatewayMediaReadPath, isMediaUri } from './media-uri';

export type ImageSource = {
  uri: string;
  headers?: Record<string, string>;
};

export type ImageRenderContext = {
  apiUrl: (path: string) => string;
  token: string;
  sessionKey?: string;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=\r\n\t ]+$/.test(value) && value.length > 32;
}

export function normalizeGeneratedWorkspacePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').trim();
  const mediaIndex = normalized.lastIndexOf('/media/generated/');
  if (mediaIndex >= 0) {
    return normalized.slice(mediaIndex + 1);
  }
  if (/^media\/generated\/[^\s]+$/i.test(normalized)) {
    return normalized;
  }
  return null;
}

export function imageContentToSource(
  block: ImageContent,
  ctx: ImageRenderContext,
): ImageSource | null {
  const raw = block.source?.data?.trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith('data:')) {
    return { uri: raw };
  }

  const headers = ctx.token ? { Authorization: `Bearer ${ctx.token}` } : undefined;
  if (isHttpUrl(raw)) {
    return { uri: raw };
  }

  if (raw.startsWith('/')) {
    return { uri: ctx.apiUrl(raw), headers };
  }

  if (isMediaUri(raw)) {
    return { uri: ctx.apiUrl(buildGatewayMediaReadPath(raw, ctx.sessionKey)), headers };
  }

  if (looksLikeBase64(raw)) {
    const mimeType = block.source?.media_type || 'image/png';
    return { uri: `data:${mimeType};base64,${raw.replace(/\s/g, '')}` };
  }

  return null;
}
