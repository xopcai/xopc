// Send media tool - allows sending local files as media
import { Type } from '@sinclair/typebox';
import { readFile } from 'fs/promises';
import { basename } from 'node:path';
import { AgentTool, type AgentToolResult } from '@earendil-works/pi-agent-core';
import { checkFileSafety } from '../prompt/safety.js';
import { resolvePathUnderWorkspace } from './tool-paths.js';
import { persistToolMedia, type ToolMediaType } from './tool-media.js';
import type { MessageBus, OutboundMessage } from '../../infra/bus/index.js';

const SendMediaSchema = Type.Object({
  filePath: Type.String({
    description:
      'File to send. Relative paths are under the current agent workspace; absolute paths are used as given.',
  }),
  mediaType: Type.Optional(Type.Enum({
    photo: 'photo',
    video: 'video',
    audio: 'audio',
    document: 'document',
  }, { description: 'Type of media to send (auto-detected if not specified)' })),
  caption: Type.Optional(Type.String({ description: 'Caption for the media' })),
});

interface MessageContext {
  channel: string;
  chatId: string;
}

type SendMediaParams = {
  filePath: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'document';
  caption?: string;
};

export function createSendMediaTool(
  workspace: string,
  bus: MessageBus,
  getContext: () => MessageContext | null,
): AgentTool {
  return {
    name: 'send_media',
    description:
      'Send a media file (photo, video, audio, document) to the current conversation. Relative paths resolve to the current agent workspace (same as read_file).',
    parameters: SendMediaSchema,
    label: '📎 Send Media',

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const p = params as SendMediaParams;
      const ctx = getContext();
      if (!ctx) {
        return {
          content: [{ type: 'text', text: 'Error: No active conversation context' }],
          details: {},
        };
      }

      const resolved = resolvePathUnderWorkspace(p.filePath, workspace);
      const safety = checkFileSafety('read', resolved);
      if (!safety.allowed) {
        return {
          content: [{ type: 'text', text: `🚫 ${safety.message}` }],
          details: {},
        };
      }

      try {
        const fileBuffer = await readFile(resolved);
        const media = await persistToolMedia({
          buffer: fileBuffer,
          filePath: resolved,
          ...(p.mediaType ? { mediaType: p.mediaType as ToolMediaType } : {}),
        });

        if (ctx.channel !== 'webchat') {
          const msg: OutboundMessage = {
            channel: ctx.channel,
            chat_id: ctx.chatId,
            content: p.caption || '',
            mediaUrl: `data:${media.mimeType};base64,${fileBuffer.toString('base64')}`,
            mediaType: media.type as ToolMediaType,
          };
          await bus.publishOutbound(msg);
        }

        const fileName = basename(resolved);
        return {
          content: [{ type: 'text', text: `Media attached: ${fileName} (${media.type})` }],
          details: {
            media: [media],
            artifacts: [{
              artifactId: media.id,
              title: media.name,
              kind: media.type === 'photo'
                ? 'image'
                : media.type === 'video'
                  ? 'video'
                  : media.type === 'audio'
                    ? 'audio'
                    : media.mimeType === 'application/pdf'
                      ? 'pdf'
                      : 'file',
              mimeType: media.mimeType,
              sizeBytes: media.size,
              availability: 'available',
              location: 'artifact_store',
              capabilities: ['preview', 'download'],
              uri: media.uri,
            }],
            ...(p.caption ? { caption: p.caption } : {}),
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error sending media: ${errorMessage}` }],
          details: { error: errorMessage },
        };
      }
    },
  } as any;
}
