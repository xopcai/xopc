import { describe, expect, it } from 'vitest';

import {
  appendDynamicPromptSection,
  PROMPT_CACHE_BOUNDARY,
  splitPromptCacheBoundary,
} from '../cache-boundary.js';

describe('prompt cache boundary', () => {
  it('places per-turn context after the stable cache prefix', () => {
    const prompt = `stable${PROMPT_CACHE_BOUNDARY}existing dynamic`;
    const result = appendDynamicPromptSection(prompt, 'recalled memory');

    expect(splitPromptCacheBoundary(result)).toEqual({
      stablePrefix: 'stable',
      dynamicSuffix: 'existing dynamic\n\nrecalled memory',
    });
  });

  it('creates a boundary when a prompt has no dynamic section yet', () => {
    expect(appendDynamicPromptSection('stable', 'memory'))
      .toBe(`stable${PROMPT_CACHE_BOUNDARY}memory`);
  });
});
