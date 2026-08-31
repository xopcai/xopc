/**
 * STT for webchat voice attachments: merge transcripts into user text and track inbound voice for TTS trigger.
 */

import type { STTConfig } from '../../voice/stt/types.js';
import { isSTTAvailable, transcribe } from '../../voice/stt/index.js';
import {
  decodeInboundAttachmentBase64,
  readInboundAttachmentBuffer,
  type InboundAttachmentInput,
  type MediaRef,
} from './inbound-persist.js';

const STT_MAX_BYTES = 25 * 1024 * 1024;

export function isVoiceLikeAttachment(att: InboundAttachmentInput | MediaRef): boolean {
  if (att.type === 'voice') return true;
  const m = att.mimeType?.toLowerCase() ?? '';
  return m.startsWith('audio/');
}

export async function mergeVoiceTranscriptsIntoUserText(
  prepared: (InboundAttachmentInput | MediaRef)[] | undefined,
  userText: string,
  sttConfig: STTConfig,
  opts?: { skipVoiceTranscription?: boolean },
): Promise<{ text: string; inboundVoice: boolean; voiceTranscripts: string[] }> {
  if (!prepared?.length) {
    return { text: userText, inboundVoice: false, voiceTranscripts: [] };
  }

  const hasVoice = prepared.some(isVoiceLikeAttachment);
  if (!hasVoice) {
    return { text: userText, inboundVoice: false, voiceTranscripts: [] };
  }

  if (opts?.skipVoiceTranscription === true) {
    return { text: userText, inboundVoice: true, voiceTranscripts: [] };
  }

  if (!isSTTAvailable(sttConfig)) {
    return { text: userText, inboundVoice: true, voiceTranscripts: [] };
  }

  const transcripts: string[] = [];

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
      transcripts.push(r.text.trim() || '[Voice: no speech detected]');
    } catch {
      transcripts.push('[STT failed]');
    }
  }

  const merged = [transcripts.filter(Boolean).join('\n'), userText.trim()].filter(Boolean).join('\n\n');
  return { text: merged || userText, inboundVoice: true, voiceTranscripts: transcripts };
}
