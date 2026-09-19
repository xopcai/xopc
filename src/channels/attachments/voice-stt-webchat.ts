/**
 * STT for webchat voice attachments: merge transcripts into user text and track inbound voice for TTS trigger.
 */

import type { STTConfig } from '../../voice/stt/types.js';
import { isSTTAvailable, transcribe } from '../../voice/stt/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  decodeInboundAttachmentBase64,
  readInboundAttachmentBuffer,
  type InboundAttachmentInput,
  type MediaRef,
} from './inbound-persist.js';

const STT_MAX_BYTES = 25 * 1024 * 1024;
const log = createLogger('VoiceAttachmentSTT');

export function isVoiceLikeAttachment(att: InboundAttachmentInput | MediaRef): boolean {
  if (att.type === 'voice') return true;
  const m = att.mimeType?.toLowerCase() ?? '';
  return m.startsWith('audio/');
}

/** True when the user explicitly asks the agent to inspect the original recording. */
export function requestsOriginalVoiceInspection(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;

  const chineseActionFirst = /(?:分析|检查|听|辨别|识别|判断|检测|对比|提取).{0,12}(?:原始|原声)?(?:语音|音频|录音|声音)/u;
  const chineseMediaFirst = /(?:原始|原声)?(?:语音|音频|录音|声音).{0,12}(?:分析|检查|听|辨别|识别|判断|检测|对比|音质|音色|语气|情绪|口音|噪声|杂音|背景声|说话人|声纹)/u;
  const englishActionFirst = /\b(?:analy[sz]e|inspect|listen\s+to|check|identify|compare|detect)\b.{0,40}\b(?:(?:original|raw)\s+)?(?:audio|recording|voice(?:\s+(?:clip|message))?)\b/iu;
  const englishMediaFirst = /\b(?:(?:original|raw)\s+)?(?:audio|recording|voice(?:\s+(?:clip|message))?)\b.{0,40}\b(?:analy[sz]e|inspect|listen|quality|tone|emotion|accent|noise|background|speaker|voiceprint)\b/iu;

  return chineseActionFirst.test(normalized)
    || chineseMediaFirst.test(normalized)
    || englishActionFirst.test(normalized)
    || englishMediaFirst.test(normalized);
}

export async function mergeVoiceTranscriptsIntoUserText(
  prepared: (InboundAttachmentInput | MediaRef)[] | undefined,
  userText: string,
  sttConfig: STTConfig,
  opts?: { skipVoiceTranscription?: boolean },
): Promise<{
  text: string;
  inboundVoice: boolean;
  voiceTranscripts: string[];
  transcribedMediaUris: string[];
}> {
  if (!prepared?.length) {
    return { text: userText, inboundVoice: false, voiceTranscripts: [], transcribedMediaUris: [] };
  }

  const hasVoice = prepared.some(isVoiceLikeAttachment);
  if (!hasVoice) {
    return { text: userText, inboundVoice: false, voiceTranscripts: [], transcribedMediaUris: [] };
  }

  if (opts?.skipVoiceTranscription === true) {
    return { text: userText, inboundVoice: true, voiceTranscripts: [], transcribedMediaUris: [] };
  }

  if (!isSTTAvailable(sttConfig)) {
    return { text: userText, inboundVoice: true, voiceTranscripts: [], transcribedMediaUris: [] };
  }

  const transcripts: string[] = [];
  const transcribedMediaUris: string[] = [];

  for (const att of prepared) {
    if (!isVoiceLikeAttachment(att)) continue;

    let buf: Buffer | null = null;
    if ('uri' in att && att.uri?.trim()) {
      try {
        buf = await readInboundAttachmentBuffer(att.uri.trim());
      } catch {
        buf = null;
      }
    } else if ('data' in att && att.data) {
      try {
        buf = decodeInboundAttachmentBase64(att.data);
      } catch {
        buf = null;
      }
    }

    if (!buf || buf.length === 0) {
      transcripts.push('[Voice: empty]');
      continue;
    }
    if (buf.length > STT_MAX_BYTES) {
      transcripts.push('[Voice: file too large]');
      continue;
    }

    try {
      const r = await transcribe(buf, sttConfig, {
        language: sttConfig.provider === 'alibaba' ? 'zh' : undefined,
        mime: att.mimeType,
        fileName: att.name,
      });
      const transcript = r.text.trim();
      transcripts.push(transcript || '[Voice: no speech detected]');
      if (transcript && 'uri' in att && att.uri?.trim()) {
        transcribedMediaUris.push(att.uri.trim());
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(
        {
          ...(error instanceof Error ? { err: error } : { errorMessage }),
          fileName: att.name,
          mimeType: att.mimeType,
          size: buf.length,
          phase: 'inbound_transcribe',
        },
        `Inbound voice transcription failed: ${errorMessage}`,
      );
      const decoderUnavailable = /ffmpeg|audio decoder|unsupported_audio_codec/i.test(errorMessage);
      transcripts.push(decoderUnavailable ? '[STT failed: audio decoder unavailable]' : '[STT failed]');
    }
  }

  const merged = [transcripts.filter(Boolean).join('\n'), userText.trim()].filter(Boolean).join('\n\n');
  return {
    text: merged || userText,
    inboundVoice: true,
    voiceTranscripts: transcripts,
    transcribedMediaUris,
  };
}
