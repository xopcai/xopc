import { describe, expect, it } from 'vitest';

import { hasPersonalResultFileLinks, sanitizePersonalResultFileLinks } from '../result-file-links.js';

describe('personal result file references', () => {
  it.each([
    'MEDIA:/Users/worker/report.md', 'MEDIA: https://example.test/report.pdf',
    '[Report](/Users/worker/report.md)', '[Report](</tmp/report with spaces.md>)',
    '[Report](file:///tmp/report.pdf)', '[Report](xopc://workspace/file?path=report.md)',
    '[Report](media://outbound/report.md)', '[Report](report.pdf)',
    '[Report](%2FUsers%2Fworker%2Freport.md)', 'Download /workspace/report.md',
    'file:///tmp/report.pdf', '<file:///tmp/report.pdf>', 'Download C:\\work\\report.pdf',
    '[report]: /Users/worker/report.md', '[report]: </tmp/report with spaces.pdf>',
    '[Report](\\/Users\\/worker\\/report.md)', '[Report](\\\\server\\report.pdf)',
  ])('removes delivery references from prose: %s', text => {
    expect(hasPersonalResultFileLinks(text)).toBe(true);
    expect(hasPersonalResultFileLinks(sanitizePersonalResultFileLinks(text))).toBe(false);
  });

  it('preserves sources, product links, literal code and research content', () => {
    const text = 'Price: 2 per hour. [Source](https://example.test/Users/report.md)\n\n\n'
      + '[Note](xopc://notes/note-1)\n`/Users/example/file.ts`\n```ts\n\n\nconst path = "/tmp/file";\n```';
    expect(sanitizePersonalResultFileLinks(text)).toBe(text);
    expect(hasPersonalResultFileLinks(text)).toBe(false);
  });
});
