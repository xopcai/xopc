/**
 * STT for webchat voice attachments: merge transcripts into user text and track inbound voice for TTS trigger.
 */

import { readFile } from 'fs/promises';

import type { STTConfig } from '../../stt/types.js';
import { DEFAULT_STT_CONFIG } from '../../stt/types.js';
import { isSTTAvailable, transcribe } from '../../stt/index.js';
import {
  resolveSafeInboundFilePath,
  type InboundAttachmentInput,
  decodeInboundAttachmentBase64,
} from './inbound-persist.js';

const STT_MAX_BYTES = 25 * 1024 * 1024;

export function mergeSttConfigFromAppConfig(stt: Partial<STTConfig> | undefined): STTConfig {
  const p = stt ?? {};
  return {
    ...DEFAULT_STT_CONFIG,
    ...p,
    alibaba: { ...DEFAULT_STT_CONFIG.alibaba, ...p.alibaba },
    openai: { ...DEFAULT_STT_CONFIG.openai, ...p.openai },
    fallback: { ...DEFAULT_STT_CONFIG.fallback!, ...p.fallback },
  };
}

export function isVoiceLikeAttachment(att: InboundAttachmentInput): boolean {
  if (att.type === 'voice') return true;
  const m = att.mimeType?.toLowerCase() ?? '';
  return m.startsWith('audio/');
}

export async function mergeVoiceTranscriptsIntoUserText(
  workspaceRoot: string,
  prepared: InboundAttachmentInput[] | undefined,
  userText: string,
  sttConfig: STTConfig,
): Promise<{ text: string; inboundVoice: boolean }> {
  if (!prepared?.length) {
    return { text: userText, inboundVoice: false };
  }

  const hasVoice = prepared.some(isVoiceLikeAttachment);
  if (!hasVoice) {
    return { text: userText, inboundVoice: false };
  }

  if (!isSTTAvailable(sttConfig)) {
    return { text: userText, inboundVoice: true };
  }

  const transcripts: string[] = [];

  for (const att of prepared) {
    if (!isVoiceLikeAttachment(att)) continue;

    let buf: Buffer | null = null;
    if (att.workspaceRelativePath) {
      const abs = resolveSafeInboundFilePath(workspaceRoot, att.workspaceRelativePath);
      if (abs) {
        try {
          buf = await readFile(abs);
        } catch {
          buf = null;
        }
      }
    } else if (att.data) {
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
      });
      transcripts.push(r.text.trim() || '[Voice: no speech detected]');
    } catch {
      transcripts.push('[STT failed]');
    }
  }

  const merged = [transcripts.filter(Boolean).join('\n'), userText.trim()].filter(Boolean).join('\n\n');
  return { text: merged || userText, inboundVoice: true };
}
