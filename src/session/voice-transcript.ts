import type { AgentMessage } from '@earendil-works/pi-agent-core';

export const VOICE_CALL_TYPE = 'voice_call';
export const VOICE_TRANSCRIPT_TYPE = 'voice_omni_transcript';

/** One projection for both direct LLM loads and the embedded SessionManager. */
export function voiceTranscriptMessage(row: { content?: unknown; details?: unknown; timestamp?: string | number }): AgentMessage | null {
  const details = row.details && typeof row.details === 'object' ? row.details as Record<string, unknown> : {};
  if ((details.role !== 'user' && details.role !== 'assistant') || typeof row.content !== 'string' || !row.content.trim()) return null;
  const text = details.role === 'assistant' && details.interrupted === true
    ? '[Voice reply was interrupted. Its generated text is omitted because the heard portion is unknown.]'
    : row.content;
  const parsed = typeof row.timestamp === 'number' ? row.timestamp : Date.parse(row.timestamp ?? '');
  const timestamp = Number.isFinite(parsed) ? parsed : 0;
  const content = [{ type: 'text' as const, text }];
  if (details.role === 'user') return { role: 'user', content, timestamp };
  return {
    role: 'assistant', content, timestamp,
    api: 'openai-completions', provider: 'xopc-voice', model: 'voice-transcript', stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}
