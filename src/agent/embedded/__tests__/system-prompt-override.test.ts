import { describe, expect, it } from 'vitest';
import { getCurrentSystemPrompt } from '@earendil-works/pi-ai';

import { applySystemPromptOverrideToSession } from '../system-prompt-override.js';

describe('applySystemPromptOverrideToSession', () => {
  it('locks system prompt and rebuild hook', () => {
    const session = {
      agent: { state: { messages: [], tools: [] } },
      _baseSystemPromptOptions: {},
      _rebuildSystemPrompt() {
        this._baseSystemPromptOptions = {};
      },
    } as Parameters<typeof applySystemPromptOverrideToSession>[0];

    applySystemPromptOverrideToSession(session, 'xopc-owned prompt');

    expect(getCurrentSystemPrompt(session.agent.state.messages)).toBe('xopc-owned prompt');
    const mutable = session as unknown as {
      _baseSystemPromptOptions?: { forceSystemPrompt?: string };
      _rebuildSystemPrompt?: (toolNames: string[]) => void;
    };
    expect(mutable._baseSystemPromptOptions?.forceSystemPrompt).toBe('xopc-owned prompt');
    mutable._rebuildSystemPrompt?.([]);
    expect(mutable._baseSystemPromptOptions?.forceSystemPrompt).toBe('xopc-owned prompt');
  });
});
