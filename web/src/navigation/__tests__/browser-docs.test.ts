import { describe, expect, it } from 'vitest';

import { browserDocsUrl } from '@/navigation';

describe('browserDocsUrl', () => {
  it('points to tools browser section for each locale', () => {
    expect(browserDocsUrl('en')).toBe('https://xopcai.github.io/xopc/tools#browser-optional');
    expect(browserDocsUrl('zh')).toBe('https://xopcai.github.io/xopc/zh/tools#browser-optional');
  });
});
