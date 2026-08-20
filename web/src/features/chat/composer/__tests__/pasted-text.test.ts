import { describe, expect, it } from 'vitest';

import { classifyPastedText } from '@/features/chat/composer/pasted-text';

describe('classifyPastedText', () => {
  it('keeps normal prose and short snippets in the editor', () => {
    expect(classifyPastedText('A normal short message.')).toBeNull();
    expect(classifyPastedText('<div>Hello</div>')).toBeNull();
  });

  it('classifies a large DOM snapshot as a plain text HTML attachment', () => {
    const text = `<body>${'<div class="flex">content</div>'.repeat(300)}</body>`;
    const result = classifyPastedText(text);

    expect(result).toMatchObject({
      text,
      name: 'pasted-text.html',
      mimeType: 'text/html',
      lineCount: 1,
    });
    expect(result?.byteLength).toBeGreaterThanOrEqual(8 * 1024);
  });

  it('collapses multi-line code before it reaches the general large-paste threshold', () => {
    const text = Array.from({ length: 20 }, (_, index) => `const value${index} = ${index};`).join('\n');
    expect(classifyPastedText(text)).toMatchObject({
      name: 'pasted-code.txt',
      mimeType: 'text/plain',
      lineCount: 20,
    });
  });

  it('uses UTF-8 byte length for large non-ASCII text', () => {
    const result = classifyPastedText('中'.repeat(3_000));
    expect(result?.byteLength).toBe(9_000);
    expect(result?.name).toBe('pasted-text.txt');
  });
});
