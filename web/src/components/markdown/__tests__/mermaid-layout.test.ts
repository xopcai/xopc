import { describe, expect, it } from 'vitest';

import { estimateMermaidPlaceholderHeight } from '@/components/markdown/markdown-view';

describe('estimateMermaidPlaceholderHeight', () => {
  it('reserves a bounded frame based on diagram complexity', () => {
    expect(estimateMermaidPlaceholderHeight('graph TD\nA-->B')).toBe(180);
    expect(
      estimateMermaidPlaceholderHeight(
        Array.from({ length: 20 }, (_, index) => `N${index}-->N${index + 1}`).join('\n'),
      ),
    ).toBe(360);
  });
});
