import type { Config } from '../../config/schema.js';
import { persistOutboundTtsAudio } from '../../channels/attachments/outbound-tts-persist.js';
import { compressAudio } from '../../voice/tts/audio.js';
import { speak } from '../../voice/tts/index.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { shouldUseTTS, getChannelOutputFormat } from '../../voice/tts/service.js';
import { isTTSAvailable } from '../../voice/tts/factory.js';
import { resolveAgentHomeDir } from '../agent-scope.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import type { AgentManager } from '../agent-manager.js';
import type { SessionStore } from '../../session/index.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

export type WebchatTtsResult = {
  type: 'tts_audio';
  workspaceRelativePath: string;
  mimeType: string;
  name: string;
};

export type WebchatTtsDeps = {
  config: Config | undefined;
  agentManager: AgentManager;
  sessionStore: SessionStore;
  log: { warn: (obj: Record<string, unknown>, msg: string) => void };
};

/**
 * Generate TTS for webchat when config allows; persist under agent home `tts/`.
 */
export async function maybeEmitWebchatTts(
  deps: WebchatTtsDeps,
  sessionKey: string,
  hadInboundVoice: boolean,
): Promise<WebchatTtsResult | null> {
  const ttsConfig = mergeTtsConfigFromAppConfig(deps.config?.tts);
  if (!isTTSAvailable(ttsConfig)) {
    return null;
  }
  const decision = shouldUseTTS(ttsConfig, hadInboundVoice);
  if (!decision.useTTS) {
    return null;
  }
  const text = deps.agentManager.getLastAssistantContent(sessionKey)?.trim();
  if (!text) {
    return null;
  }
  try {
    const webOut = getChannelOutputFormat('webchat');
    const fmt = webOut.format as 'opus' | 'mp3' | 'wav';
    const ttsResult = await speak(text, ttsConfig, {
      appConfig: deps.config,
      tts: { format: fmt },
    });
    const { buffer, format } = await compressAudio(
      Buffer.from(ttsResult.audio),
      ttsResult.format,
      webOut.format === 'mp3' ? 'mp3' : 'opus',
    );
    const normalizedMime =
      format === 'opus' || format === 'ogg'
        ? 'audio/ogg'
        : format === 'mp3' || format === 'mpeg'
          ? 'audio/mpeg'
          : format === 'wav'
            ? 'audio/wav'
            : `audio/${format}`;
    const cfg = deps.config!;
    const persisted = await persistOutboundTtsAudio(
      resolveAgentHomeDir(cfg, extractProfileAgentId(sessionKey, cfg)),
      sessionKey,
      buffer,
      format,
    );
    await appendAttachmentToLastAssistant(deps.sessionStore, sessionKey, {
      type: 'audio',
      mimeType: normalizedMime,
      name: persisted.name,
      size: persisted.size,
      workspaceRelativePath: persisted.workspaceRelativePath,
    });
    return {
      type: 'tts_audio',
      workspaceRelativePath: persisted.workspaceRelativePath,
      mimeType: normalizedMime,
      name: persisted.name,
    };
  } catch (err) {
    deps.log.warn({ err, sessionKey }, 'Webchat TTS failed');
    return null;
  }
}

export async function appendAttachmentToLastAssistant(
  sessionStore: SessionStore,
  sessionKey: string,
  att: {
    type: string;
    mimeType: string;
    name: string;
    size: number;
    workspaceRelativePath: string;
  },
): Promise<void> {
  const loaded = await sessionStore.load(sessionKey);
  for (let i = loaded.length - 1; i >= 0; i--) {
    const m = loaded[i] as { role?: string; attachments?: unknown[] };
    if (m.role === 'assistant') {
      const prev = (m.attachments ?? []) as Array<{ workspaceRelativePath?: string }>;
      if (prev.some((x) => x.workspaceRelativePath === att.workspaceRelativePath)) {
        return;
      }
      const next = [...prev, att];
      loaded[i] = { ...m, attachments: next } as unknown as AgentMessage;
      await sessionStore.save(sessionKey, loaded);
      return;
    }
  }
}
