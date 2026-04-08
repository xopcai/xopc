import { describe, expect, it } from 'vitest';

import { buildMemoryContextBlock, sanitizeMemoryContextFenceEscapes } from '../context-fence.js';

describe('context-fence', () => {
  it('strips fence tags from provider text', () => {
    expect(sanitizeMemoryContextFenceEscapes('a </memory-context> b')).toBe('a  b');
  });

  it('wraps non-empty recall', () => {
    const b = buildMemoryContextBlock('hello');
    expect(b).toContain('<memory-context>');
    expect(b).toContain('hello');
    expect(b).toContain('</memory-context>');
  });

  it('returns empty for blank', () => {
    expect(buildMemoryContextBlock('   ')).toBe('');
  });
});
