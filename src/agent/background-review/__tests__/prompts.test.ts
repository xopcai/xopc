import { describe, expect, it } from 'vitest';

import { buildUnderstandingInterpreterPrompt } from '../prompts.js';

describe('background understanding prompt', () => {
  it('requests user-facing profile copy without generic user prefixes', () => {
    const prompt = buildUnderstandingInterpreterPrompt({ mode: 'transcript' });
    expect(prompt).toContain('can be shown directly to the person described');
    expect(prompt).toContain('倾向使用 pnpm 作为包管理器');
    expect(prompt).toContain('not “用户倾向于使用 pnpm”');
    expect(prompt).toContain('Do not begin with generic subject labels or pronouns');
  });
});
