// Send media tool - allows sending local files as media
import { Type, type Static } from '@sinclair/typebox';
import { readFile } from 'fs/promises';
import { AgentTool, type AgentToolResult } from '@mariozechner/pi-agent-core';
import type { MessageBus, OutboundMessage } from '../../bus/index.js';

const SendMediaSchema = Type.Object({
  filePath: Type.String({ description: 'Local file path to send' }),
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

// Detect media type from file extension
function detectMediaType(filePath: string): 'photo' | 'video' | 'audio' | 'document' {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
  const videoExts = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

  if (imageExts.includes(ext || '')) return 'photo';
  if (videoExts.includes(ext || '')) return 'video';
  if (audioExts.includes(ext || '')) return 'audio';
  return 'document';
}

// Detect MIME type from file extension
function detectMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
  };
  return mimeMap[ext || ''] || 'application/octet-stream';
}

export function createSendMediaTool(
  bus: MessageBus,
  getContext: () => MessageContext | null
): AgentTool<typeof SendMediaSchema, {}> {
  return {
    name: 'send_media',
    description: 'Send a media file (photo, video, audio, document) from local filesystem to the current conversation.',
    parameters: SendMediaSchema,
    label: '📎 Send Media',

    async execute(
      toolCallId: string,
      params: Static<typeof SendMediaSchema>,
      _signal?: AbortSignal
    ): Promise<AgentToolResult<{}>> {
      const ctx = getContext();
      if (!ctx) {
        return {
          content: [{ type: 'text', text: 'Error: No active conversation context' }],
          details: {},
        };
      }

      try {
        // Read the local file
        const fileBuffer = await readFile(params.filePath);
        const base64 = fileBuffer.toString('base64');
        const mimeType = detectMimeType(params.filePath);

        // Determine media type
        const mediaType = params.mediaType || detectMediaType(params.filePath);

        // Create data URL
        const dataUrl = `data:${mimeType};base64,${base64}`;

        const msg: OutboundMessage = {
          channel: ctx.channel,
          chat_id: ctx.chatId,
          content: params.caption || '',
          mediaUrl: dataUrl,
          mediaType,
        };

        await bus.publishOutbound(msg);

        const fileName = params.filePath.split('/').pop() || params.filePath;
        return {
          content: [{ type: 'text', text: `✅ Media sent: ${fileName} (${mediaType})` }],
          details: { filePath: params.filePath, mediaType },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error sending media: ${errorMessage}` }],
          details: { error: errorMessage },
        };
      }
    },
  };
}
