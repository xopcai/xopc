import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { enqueueMusicJob, getMusicJob, listMusicJobs, publicMusicJob } from '../../music-generation/repository.js';
import { configuredMusicModel } from '../../music-generation/providers.js';
import { getCurrentTranscriptId } from '../../storage/sqlite/session-repository.js';

const schema = Type.Object({
  action: Type.Union([Type.Literal('generate'), Type.Literal('inspect')]),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  mode: Type.Optional(Type.Union([Type.Literal('song'), Type.Literal('instrumental')])),
  prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 5000 })),
  lyrics: Type.Optional(Type.String({ minLength: 1, maxLength: 12000 })),
  parentId: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
}, { additionalProperties: false });

export function createMusicGenerationTool(getConversationId: () => string | undefined): AgentTool<typeof schema> {
  return {
    name: 'music_generation',
    label: 'Create music',
    description: 'Generate a song or instrumental as an asynchronous paid request in this chat, or inspect existing requests. '
      + 'Generate only when the user explicitly asks to create audio or confirms their earlier lyrics or brief. '
      + 'For a new song provide a title, song mode, a style prompt, and complete lyrics. Keep user-supplied lyrics verbatim. '
      + 'If the user has no preference, inspect the configured default mode before preparing the request. '
      + 'For an instrumental omit lyrics. If the user asks to review lyrics first, show them in chat and wait for their request to generate. '
      + 'For revisions, inspect completed versions, pass the exact parentId and only fields the user wants changed. Ask which version if ambiguous. '
      + 'The tool enqueues one work per call. Do not repeat generation to check progress or after an unconfirmed submission. '
      + 'Use inspect for status, or inspect with parentId to read the exact prior input, and tell the user to play the result from the chat card when ready.',
    parameters: schema,
    async execute(toolCallId, { action, ...request }, signal) {
      signal?.throwIfAborted();
      const conversationId = getConversationId();
      if (!conversationId) throw new Error('Music generation is available in Web chat.');
      const transcriptId = getCurrentTranscriptId(conversationId);
      if (!transcriptId) throw new Error('The current chat is unavailable.');

      if (action === 'inspect') {
        const route = await configuredMusicModel();
        const selected = request.parentId ? getMusicJob(conversationId, request.parentId) : undefined;
        const result = request.parentId
          ? { job: selected?.transcript_id === transcriptId ? publicMusicJob(selected) : null }
          : {
              configured: Boolean(route),
              capabilities: route?.capabilities,
              defaults: route?.defaults,
              jobs: listMusicJobs(conversationId, transcriptId).slice(0, 12).map(({ lyrics, prompt, ...job }) => job),
            };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      }
      const result = await enqueueMusicJob(conversationId, transcriptId, toolCallId, request, signal);
      const receipt = result.job ? { id: result.job.id, workId: result.job.workId, state: result.job.state } : result;
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt };
    },
  };
}
