import { describe, expect, it } from 'vitest';

import { MEMORY_REVIEW_USER_PROMPT } from '../prompts.js';

describe('background understanding prompt', () => {
  it('requests user-facing profile copy without generic user prefixes', () => {
    expect(MEMORY_REVIEW_USER_PROMPT).toContain('can be shown directly to the person described');
    expect(MEMORY_REVIEW_USER_PROMPT).toContain('倾向使用 pnpm 作为包管理器');
    expect(MEMORY_REVIEW_USER_PROMPT).toContain('not “用户倾向于使用 pnpm”');
    expect(MEMORY_REVIEW_USER_PROMPT).toContain('Do not begin with generic subject labels or pronouns');
  });
});
