/**
 * STT for webchat voice attachments: merge transcripts into user text and track inbound voice for TTS trigger.
 */

import { readFile } from 'fs/promises';

import type { STTConfig } from '../../voice/stt/types.js';
import { DEFAULT_STT_CONFIG } from '../../voice/stt/types.js';
import { isSTTAvailable, transcribe } from '../../voice/stt/index.js';
import {
  resolveSafeInboundFilePath,
  type InboundAttachmentInput,
  type InternalAttachmentRoots,
  decodeInboundAttachmentBase64,
} from './inbound-persist.js';

const STT_MAX_BYTES = 25 * 1024 * 1024;

function mergeSttProviders(
  base: STTConfig['providers'],
  patch: STTConfig['providers'],
): STTConfig['providers'] {
  if (!base && !patch) return undefined;
  const merged: Record<string, Record<string, unknown>> = { ...(base ?? {}) };
  for (const [id, slice] of Object.entries(patch ?? {})) {
    merged[id] = { ...(merged[id] ?? {}), ...slice };
  }
  return merged;
}

export function mergeSttConfigFromAppConfig(
  stt: Partial<STTConfig> | undefined,
  toolsMedia?: { models?: STTConfig['sharedModels'] },
): STTConfig {
  const p = stt ?? {};
  return {
    ...DEFAULT_STT_CONFIG,
    ...p,
    providers: mergeSttProviders(DEFAULT_STT_CONFIG.providers, p.providers),
    fallback: { ...DEFAULT_STT_CONFIG.fallback!, ...p.fallback },
    ...(toolsMedia?.models?.length ? { sharedModels: toolsMedia.models } : {}),
  };
}

export function isVoiceLikeAttachment(att: InboundAttachmentInput): boolean {
  if (att.type === 'voice') return true;
  const m = att.mimeType?.toLowerCase() ?? '';
  return m.startsWith('audio/');
}

export async function mergeVoiceTranscriptsIntoUserText(
  attachmentRoots: InternalAttachmentRoots,
  prepared: InboundAttachmentInput[] | undefined,
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
    if (att.workspaceRelativePath) {
      const abs = resolveSafeInboundFilePath(attachmentRoots, att.workspaceRelativePath);
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
  return { text: merged || userText, inboundVoice: true, voiceTranscripts: transcripts };
}
