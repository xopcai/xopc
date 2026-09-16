import { expect, it } from 'vitest';

import { validateConversationId, validateTranscriptId } from './conversation-identity.js';
import { parseSessionResponse } from './sessions.js';

it('normalizes UUID conversation identities and rejects encoded routing keys', () => {
  expect(validateConversationId('9A371150-1EAA-4218-8EBB-C37FDF81A3F6')).toBe('9a371150-1eaa-4218-8ebb-c37fdf81a3f6');
  expect(() => validateConversationId('agent:coder:webchat:default:direct:chat_test')).toThrow();
});

it('preserves historical transcript tokens through the public response contract', () => {
  const transcriptId = 'Imported-Transcript-1';
  expect(validateTranscriptId(transcriptId)).toBe(transcriptId);
  const parsed = parseSessionResponse({ session: {
    key: '9a371150-1eaa-4218-8ebb-c37fdf81a3f6', transcriptId, messages: [],
  } });
  expect(parsed.session.transcriptId).toBe(transcriptId);
  expect(() => validateTranscriptId('../unsafe')).toThrow();
});
