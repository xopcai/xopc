import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { readMediaReference } from '../../media/media-reference.js';
import { MEDIA_MAX_BYTES, mimeTypeFromMediaPath } from '../../media/store.js';

const DEFAULT_MAX_BYTES = MEDIA_MAX_BYTES;
const HARD_MAX_BYTES = MEDIA_MAX_BYTES;

const ReadMediaSchema = Type.Object({
  uri: Type.String({
    description: 'The media:// URI from an xopc-media-uri line in the user message.',
  }),
  maxBytes: Type.Optional(Type.Number({
    description: 'Maximum bytes to read, capped at 5 MiB.',
  })),
});

function isLikelyText(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript'
  );
}

function clampMaxBytes(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_MAX_BYTES;
  }
  return Math.min(Math.floor(raw), HARD_MAX_BYTES);
}

export function createReadMediaTool(options?: { textOnly?: boolean; maxChars?: number; maxReadBytes?: number }): AgentTool {
  return {
    name: 'read_media',
    label: 'Read Media Attachment',
    description:
      'Read an attachment by media:// URI. Use this for xopc-media-uri attachments in user messages.',
    parameters: ReadMediaSchema,
    supportsParallel: true,
    idempotent: true,

    async execute(
      _toolCallId: string,
      params: { uri?: string; maxBytes?: number },
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const uri = typeof params.uri === 'string' ? params.uri.trim() : '';
      if (!uri) {
        return {
          content: [{ type: 'text', text: 'Missing media URI.' }],
          details: { ok: false, error: 'missing_uri' },
        };
      }

      try {
        const maxBytes = Math.min(clampMaxBytes(params.maxBytes), options?.maxReadBytes ?? HARD_MAX_BYTES);
        const { buffer, path } = await readMediaReference(uri, maxBytes);
        const mimeType = mimeTypeFromMediaPath(path);
        const metadata = {
          ok: true,
          uri,
          mimeType,
          size: buffer.byteLength,
          path,
        };

        if (isLikelyText(mimeType)) {
          const fullText = buffer.toString('utf8');
          const maxChars = options?.maxChars ?? fullText.length;
          const truncated = fullText.length > maxChars;
          const text = fullText.slice(0, maxChars) + (truncated ? '\n[Attachment truncated; delegate full analysis to a specialist.]' : '');
          return {
            content: [{ type: 'text', text }],
            details: { ...metadata, kind: 'text', truncated, ...(truncated && options?.textOnly ? { requiresSpecialist: true, reason: 'large_attachment' } : {}) },
          };
        }

        if (options?.textOnly) {
          return { content: [{ type: 'text', text: 'Binary attachment: delegate document parsing or media analysis to a specialist.' }],
            details: { ...metadata, kind: 'binary', requiresSpecialist: true } };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...metadata,
                kind: 'binary',
                base64: buffer.toString('base64'),
              }, null, 2),
            },
          ],
          details: { ...metadata, kind: 'binary' },
        };
      } catch (err) {
        if (options?.textOnly && (err as { code?: string })?.code === 'MEDIA_READ_LIMIT') {
          const size = (err as { size: number }).size;
          return { content: [{ type: 'text', text: `Attachment is large (${size} bytes; local read limit ${options.maxReadBytes ?? HARD_MAX_BYTES} bytes). Tell the user briefly, then delegate reading and processing with this URI: ${uri}` }],
            details: { ok: true, uri, size, requiresSpecialist: true, reason: 'large_attachment' } };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Media read error: ${message}` }],
          details: { ok: false, error: message },
        };
      }
    },
  } as AgentTool;
}
