import { describe, expect, it } from 'vitest';

import { applyMarkdownPatch, applyMarkdownPatchResult, getMarkdownPatchChangedRange, getMarkdownPatchPreviewSnippets } from '../markdown/markdown-patch';

describe('markdown-patch', () => {
  it('applies range operations from the end of the document', () => {
    const result = applyMarkdownPatch('Alpha Beta Gamma', [
      { type: 'replaceRange', from: 6, to: 10, markdown: 'Delta' },
      { type: 'insertAt', offset: 0, markdown: '# ' },
    ]);

    expect(result).toBe('# Alpha Delta Gamma');
  });

  it('replaces a heading section while preserving the heading', () => {
    const result = applyMarkdownPatch([
      '## Plan',
      '',
      'Old plan',
      '',
      '## Details',
      '',
      'Keep this',
    ].join('\n'), [
      { type: 'replaceSection', sectionId: 'plan', markdown: 'New plan' },
    ]);

    expect(result).toBe([
      '## Plan',
      '',
      'New plan',
      '',
      '## Details',
      '',
      'Keep this',
    ].join('\n'));
  });

  it('replaces a section with an explicit heading id', () => {
    const result = applyMarkdownPatch('## Next step {#next-step}\n\nOld', [
      { type: 'replaceSection', sectionId: 'next-step', markdown: '- [ ] Ship' },
    ]);

    expect(result).toBe('## Next step {#next-step}\n\n- [ ] Ship');
  });

  it('replaces duplicate heading sections by outline id', () => {
    const result = applyMarkdownPatch([
      '## Next step',
      '',
      'Keep first',
      '',
      '## Next step',
      '',
      'Replace second',
      '',
      '## Later',
      '',
      'Keep later',
    ].join('\n'), [
      { type: 'replaceSection', sectionId: 'next-step-2', markdown: 'Second updated' },
    ]);

    expect(result).toBe([
      '## Next step',
      '',
      'Keep first',
      '',
      '## Next step',
      '',
      'Second updated',
      '',
      '## Later',
      '',
      'Keep later',
    ].join('\n'));
  });

  it('returns metadata separately from markdown changes', () => {
    const result = applyMarkdownPatchResult('Body', [
      { type: 'updateMetadata', title: 'Better title', tags: ['ai'], status: 'processed' },
      { type: 'appendSection', heading: 'Summary', markdown: 'Done' },
    ]);

    expect(result.markdown).toBe('Body\n\n## Summary\n\nDone\n');
    expect(result.metadata).toEqual({ title: 'Better title', tags: ['ai'], status: 'processed' });
  });

  it('keeps null metadata titles so AI patches can clear the note title', () => {
    const result = applyMarkdownPatchResult('Body', [
      { type: 'updateMetadata', title: null },
    ]);

    expect(result.markdown).toBe('Body');
    expect(result.metadata).toEqual({ title: null });
  });

  it('applies frontmatter patch operations', () => {
    const result = applyMarkdownPatch('Body', [
      { type: 'updateFrontmatter', patch: { title: 'Idea', tags: ['ai', 'mobile'], pinned: true, score: 2 } },
    ]);

    expect(result).toBe([
      '---',
      'title: "Idea"',
      'tags: ["ai", "mobile"]',
      'pinned: true',
      'score: 2',
      '---',
      '',
      'Body',
    ].join('\n'));
  });

  it('merges and removes existing frontmatter fields', () => {
    const result = applyMarkdownPatch([
      '---',
      'title: "Old"',
      'tags: ["draft"]',
      'archived: false',
      '---',
      '',
      '# Note',
    ].join('\n'), [
      { type: 'updateFrontmatter', patch: { title: 'New', tags: null, archived: true } },
    ]);

    expect(result).toBe([
      '---',
      'title: "New"',
      'archived: true',
      '---',
      '',
      '# Note',
    ].join('\n'));
  });

  it('ignores unsupported frontmatter values', () => {
    const result = applyMarkdownPatchResult('Body', [
      { type: 'updateFrontmatter', patch: { ok: 'yes', removeMe: null, nested: { no: true }, list: ['a', { no: true }] } },
    ]);

    expect(result.markdown).toBe([
      '---',
      'ok: "yes"',
      '---',
      '',
      'Body',
    ].join('\n'));
    expect(result.metadata.frontmatter).toEqual({ ok: 'yes', removeMe: null });
  });

  it('summarizes patch previews around the changed markdown', () => {
    const before = ['Intro', 'A'.repeat(80), 'Old decision', 'Outro'].join('\n');
    const after = ['Intro', 'A'.repeat(80), 'New decision', 'Outro'].join('\n');

    expect(getMarkdownPatchPreviewSnippets(before, after, 20, 120)).toEqual({
      before: `...\n${'A'.repeat(19)}\nOld decision\nOutro`,
      after: `...\n${'A'.repeat(19)}\nNew decision\nOutro`,
      changed: true,
    });
  });

  it('returns stable snippets when a patch has no markdown change', () => {
    const markdown = `${'A'.repeat(20)}\n${'B'.repeat(20)}`;

    expect(getMarkdownPatchPreviewSnippets(markdown, markdown, 6, 16)).toEqual({
      before: `${'A'.repeat(16)}\n...`,
      after: `${'A'.repeat(16)}\n...`,
      changed: false,
    });
  });

  it('hides frontmatter in patch preview snippets', () => {
    expect(getMarkdownPatchPreviewSnippets(
      '---\ntitle: "Old"\n---\n\nBody',
      '---\ntitle: "New"\n---\n\nBody',
      20,
      120,
    )).toEqual({
      before: 'Body',
      after: 'Body',
      changed: false,
    });

    expect(getMarkdownPatchPreviewSnippets(
      '---\ntitle: "Old"\n---\n\nBody old',
      '---\ntitle: "New"\n---\n\nBody new',
      20,
      120,
    )).toEqual({
      before: 'Body old',
      after: 'Body new',
      changed: true,
    });
  });

  it('returns the changed range in the after markdown', () => {
    expect(getMarkdownPatchChangedRange('Alpha Beta Gamma', 'Alpha Delta Gamma')).toEqual({
      start: 6,
      end: 11,
    });
    expect(getMarkdownPatchChangedRange('Alpha Gamma', 'Alpha Beta Gamma')).toEqual({
      start: 6,
      end: 11,
    });
    expect(getMarkdownPatchChangedRange('Alpha', 'Alpha')).toBeNull();
  });
});
