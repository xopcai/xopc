import { describe, expect, it } from 'vitest';

import { applySystemPromptOverrideToSession } from '../system-prompt-override.js';

describe('applySystemPromptOverrideToSession', () => {
  it('locks system prompt and rebuild hook', () => {
    const session = {
      agent: { state: { systemPrompt: '' } },
    } as Parameters<typeof applySystemPromptOverrideToSession>[0];

    applySystemPromptOverrideToSession(session, 'xopc-owned prompt');

    expect(session.agent.state.systemPrompt).toBe('xopc-owned prompt');
    const mutable = session as unknown as {
      _baseSystemPrompt?: string;
      _rebuildSystemPrompt?: (toolNames: string[]) => string;
    };
    expect(mutable._baseSystemPrompt).toBe('xopc-owned prompt');
    expect(mutable._rebuildSystemPrompt?.(['read_file'])).toBe('xopc-owned prompt');
  });
});
