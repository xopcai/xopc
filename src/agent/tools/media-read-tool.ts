import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { readMediaReference } from '../../media/media-reference.js';
import { mimeTypeFromMediaPath } from '../../media/store.js';

const DEFAULT_MAX_BYTES = 1024 * 1024;
const HARD_MAX_BYTES = 5 * 1024 * 1024;

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

export function createReadMediaTool(): AgentTool {
  return {
    name: 'read_media',
    label: 'Read Media Attachment',
    description:
      'Read an attachment by media:// URI. Use this for xopc-media-uri attachments in user messages.',
    parameters: ReadMediaSchema,

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
        const maxBytes = clampMaxBytes(params.maxBytes);
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
          const text = buffer.toString('utf8');
          return {
            content: [{ type: 'text', text }],
            details: { ...metadata, kind: 'text' },
          };
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
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Media read error: ${message}` }],
          details: { ok: false, error: message },
        };
      }
    },
  } as AgentTool;
}
