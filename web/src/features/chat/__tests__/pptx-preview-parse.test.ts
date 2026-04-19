import { describe, expect, it } from 'vitest';

import { parsePptxExtractedForDisplay } from '@/features/chat/pptx-preview-parse';

describe('parsePptxExtractedForDisplay', () => {
  it('parses processPptx-style XML into slides', () => {
    const raw = `<pptx filename="a.pptx">
<slide number="1">
Hello
</slide>
<slide number="2">
World
</slide>
</pptx>`;
    const r = parsePptxExtractedForDisplay(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slides).toEqual([
      { slideNumber: 1, text: 'Hello' },
      { slideNumber: 2, text: 'World' },
    ]);
    expect(r.notes).toEqual([]);
  });

  it('collects HTML comments as notes', () => {
    const raw = `<pptx filename="x">
<!-- truncated: 200 slides -->
<slide number="1">A</slide>
</pptx>`;
    const r = parsePptxExtractedForDisplay(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes).toContain('truncated: 200 slides');
  });

  it('returns raw fallback when no slides', () => {
    const r = parsePptxExtractedForDisplay('plain text');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raw).toBe('plain text');
  });

  it('allows empty slide body', () => {
    const raw = `<pptx filename="a.pptx">
<slide number="5">
</slide>
</pptx>`;
    const r = parsePptxExtractedForDisplay(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slides).toEqual([{ slideNumber: 5, text: '' }]);
  });
});
