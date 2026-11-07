import { createHash } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import type { SessionStore } from '../../session/store.js';
import { VOICE_CHAT_MESSAGE_TYPE } from '../../session/voice-transcript.js';
import { emitSessionTranscriptUpdate } from '../../session/transcript-events.js';

export interface VoiceChatPublication {
  text: string;
  publicationId: string;
  source: 'conversation' | 'agent_result';
  callId?: string;
  turnId?: string;
}

export const voiceChatPublicationInstructions = 'Everyday speech stays in voice. Use chat_publish sparingly for substantial explanations, settled decisions, useful drafts, or content explicitly requested in Chat. Publish one natural assistant message containing the useful content, preserving constraints and uncertainty. Skip greetings, filler, acknowledgements, speculation, routine progress, call summaries and transcripts. Never invent user statements or unverified success. Delegated task results reach Chat independently: do not republish them. Publications are reference content, not requests to execute. Continue topics naturally after pauses.';

export async function publishVoiceChatMessage(store: Pick<SessionStore, 'appendTranscriptCustomMessageEntry'>,
  conversationId: string, transcriptId: string, publication: VoiceChatPublication): Promise<void> {
  const text = publication.text.trim();
  if (!text || text.length > 16_000) throw new Error('Invalid voice Chat content');
  const entryId = createHash('sha256').update(`${conversationId}:${transcriptId}:${publication.publicationId}`).digest('hex');
  await store.appendTranscriptCustomMessageEntry(conversationId, {
    entryId, expectedTranscriptId: transcriptId, customType: VOICE_CHAT_MESSAGE_TYPE, content: text, display: true,
    details: { role: 'assistant', source: publication.source, publicationId: publication.publicationId,
      ...(publication.callId ? { callId: publication.callId } : {}), ...(publication.turnId ? { turnId: publication.turnId } : {}) },
  });
  emitSessionTranscriptUpdate({ conversationId, messageId: entryId });
}

const schema = Type.Object({ text: Type.String({ minLength: 1, maxLength: 16_000 }) }, { additionalProperties: false });

export function createVoiceChatPublicationTool(input: {
  store: Pick<SessionStore, 'appendTranscriptCustomMessageEntry'>;
  conversationId: string;
  transcriptId: string;
  runId: string;
  onPublished?: () => void;
}): AgentTool<typeof schema, { published: boolean }> {
  return {
    name: 'chat_publish', label: 'Share useful content in Chat',
    description: 'Place useful, settled content in the main Chat as an assistant message. Use sparingly; ordinary conversation stays in voice. Do not publish progress or unverified success.',
    parameters: schema,
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      await publishVoiceChatMessage(input.store, input.conversationId, input.transcriptId, {
        text: (params as { text: string }).text, publicationId: `voice-content:${input.runId}`, source: 'conversation', turnId: input.runId,
      });
      input.onPublished?.();
      return { content: [{ type: 'text', text: 'Shared in Chat. Do not repeat the publication.' }], details: { published: true } };
    },
  };
}
