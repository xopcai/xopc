import { describe, expect, it } from 'vitest';

import { ConversationLaunchInputSchema, ConversationOriginSchema } from './conversation-launch.js';

describe('conversation launch contract', () => {
  it('defaults to the current project and preserves the exact requested first message', () => {
    expect(ConversationLaunchInputSchema.parse({ prompt: ' hello\n' })).toEqual({ prompt: ' hello\n', project: { kind: 'current' } });
    expect(ConversationLaunchInputSchema.safeParse({ prompt: ' \n ' }).success).toBe(false);
  });
  it('requires an explicit project identity and never accepts caller-supplied provenance', () => {
    expect(ConversationLaunchInputSchema.safeParse({ prompt: 'hello', project: { kind: 'project' } }).success).toBe(false);
    expect(ConversationLaunchInputSchema.safeParse({ prompt: 'hello', sourceConversationId: 'forged' }).success).toBe(false);
    expect(ConversationOriginSchema.safeParse({ conversationId: 'invalid', launchId: 'invalid', agentId: 'main' }).success).toBe(false);
  });
});
