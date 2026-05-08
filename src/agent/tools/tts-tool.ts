import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { MessageBus, OutboundMessage } from '../../infra/bus/index.js';
import { speak } from '../../voice/tts/speak-core.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { getChannelOutputFormat } from '../../voice/tts/service.js';
import { compressAudio } from '../../voice/tts/audio.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Agent:TTSTool');

const TextToSpeechSchema = Type.Object({
  text: Type.String({
    description:
      'Plain text to convert to speech. Natural language only; avoid code blocks and long URLs.',
  }),
  voice: Type.Optional(
    Type.String({ description: 'Optional voice id override (provider-specific).' }),
  ),
  speed: Type.Optional(
    Type.Number({
      description: 'Speech speed multiplier 0.25–4.0 (provider support varies).',
      minimum: 0.25,
      maximum: 4,
    }),
  ),
});

export interface TextToSpeechToolDeps {
  bus: MessageBus;
  getContext: () => { channel: string; chatId: string } | null;
  getConfig: () => Config | undefined;
}

export function createTextToSpeechTool(deps: TextToSpeechToolDeps): AgentTool {
  return {
    name: 'text_to_speech',
    label: '🔊 Text to speech',
    description: [
      'Convert text to speech and send it to the current chat as an audio message.',
      'Use when the user explicitly asks you to read something aloud, or when short voice output fits better than a long text reply.',
      'Do not use on every turn. Prefer clean, speakable text (no markdown fences, minimal symbols).',
    ].join(' '),
    parameters: TextToSpeechSchema,

    async execute(
      _toolCallId: string,
      params: Static<typeof TextToSpeechSchema>,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const ctx = deps.getContext();
      if (!ctx) {
        return {
          content: [{ type: 'text', text: 'Error: No active conversation context' }],
          details: {},
        };
      }

      const cfg = deps.getConfig();
      const ttsConfig = mergeTtsConfigFromAppConfig(cfg?.messages?.tts);
      if (!ttsConfig.enabled) {
        return {
          content: [{ type: 'text', text: 'TTS is not enabled in configuration.' }],
          details: {},
        };
      }

      const maxLength = ttsConfig.maxTextLength || 4096;
      if (params.text.length > maxLength) {
        return {
          content: [
            {
              type: 'text',
              text: `Text too long (${params.text.length} chars). Maximum is ${maxLength}. Shorten and retry.`,
            },
          ],
          details: {},
        };
      }

      if (!params.text.trim()) {
        return {
          content: [{ type: 'text', text: 'Text is empty.' }],
          details: {},
        };
      }

      try {
        const outFmt = getChannelOutputFormat(ctx.channel);
        const result = await speak(params.text, ttsConfig, {
          appConfig: cfg,
          tts: {
            format: outFmt.format as 'opus' | 'mp3' | 'wav',
            voice: params.voice,
            speed: params.speed,
          },
        });

        const wavTarget = outFmt.format === 'mp3' ? 'mp3' : 'opus';
        const { buffer: compressedAudio, format: compressedFormat } = await compressAudio(
          Buffer.from(result.audio),
          result.format,
          wavTarget,
        );

        const mimeType =
          compressedFormat === 'opus'
            ? 'audio/ogg'
            : compressedFormat === 'mp3' || compressedFormat === 'mpeg'
              ? 'audio/mpeg'
              : `audio/${compressedFormat}`;
        const dataUrl = `data:${mimeType};base64,${compressedAudio.toString('base64')}`;

        const msg: OutboundMessage = {
          channel: ctx.channel,
          chat_id: ctx.chatId,
          content: '',
          mediaUrl: dataUrl,
          mediaType: 'audio',
          audioAsVoice: outFmt.voiceCompatible,
        };

        await deps.bus.publishOutbound(msg);

        log.info(
          {
            provider: result.provider,
            format: compressedFormat,
            textLength: params.text.length,
            audioSize: compressedAudio.length,
          },
          'TTS tool sent audio',
        );

        return {
          content: [
            {
              type: 'text',
              text: `✅ Sent voice message (${result.provider}, ${compressedFormat}).`,
            },
          ],
          details: { provider: result.provider, format: compressedFormat },
        };
      } catch (error) {
        const em = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage: em, textLength: params.text.length }, 'TTS tool failed');
        return {
          content: [{ type: 'text', text: `TTS failed: ${em}` }],
          details: { error: em },
        };
      }
    },
  } as any;
}
