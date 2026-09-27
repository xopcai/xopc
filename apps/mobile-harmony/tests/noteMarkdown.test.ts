import { describe, expect, it } from 'vitest';
import { applyNotePatch, deriveNoteTitle, noteEditorMarkdown, noteEditorSpans } from '../entry/src/main/ets/common/noteMarkdown';
import { markdownBlocks } from '../entry/src/main/ets/common/markdown';
import { reconcileNoteSave } from '../entry/src/main/ets/common/noteSync';

describe('Harmony native note Markdown bridge', () => {
  it('creates native spans without leaking heading markers', () => {
    expect(noteEditorSpans('# Title\nBody with **bold** and _italic_').map((span) => ({
      text: span.text, bold: span.bold, italic: span.italic, heading: span.heading,
    }))).toEqual([
      { text: 'Title', bold: false, italic: false, heading: 1 },
      { text: '\n', bold: false, italic: false, heading: 0 },
      { text: 'Body with ', bold: false, italic: false, heading: 0 },
      { text: 'bold', bold: true, italic: false, heading: 0 },
      { text: ' and ', bold: false, italic: false, heading: 0 },
      { text: 'italic', bold: false, italic: true, heading: 0 },
    ]);
  });

  it('renders canonical note images while preserving attachment references in the editor', () => {
    const markdown = '![Photo](xopc-attachment://notes/note-1/att-1)';
    expect(noteEditorSpans(markdown).map(span => span.text).join('')).toBe(markdown);
    expect(markdownBlocks(markdown)).toMatchObject([{ kind: 'image', text: 'Photo', href: 'xopc-attachment://notes/note-1/att-1' }]);
  });

  it('applies offset operations from the end so original offsets remain stable', () => {
    expect(applyNotePatch('one two three', [
      { type: 'replaceRange', from: 0, to: 3, markdown: 'ONE' },
      { type: 'replaceRange', from: 8, to: 13, markdown: 'THREE' },
      { type: 'insertAt', offset: 7, markdown: '!' },
    ])).toBe('ONE two! THREE');
  });

  it('serializes native heading and inline styles back to Markdown', () => {
    expect(noteEditorMarkdown([
      { text: 'Title', fontSize: 30, fontWeight: 700, italic: false, code: false },
      { text: '\n', fontSize: 30, fontWeight: 700, italic: false, code: false },
      { text: 'A ', fontSize: 17, fontWeight: 400, italic: false, code: false },
      { text: 'bold', fontSize: 17, fontWeight: 700, italic: false, code: false },
      { text: ' word', fontSize: 17, fontWeight: 400, italic: false, code: false },
    ])).toBe('# Title\nA **bold** word');
    expect(noteEditorMarkdown([
      { text: 'const value = 1', fontSize: 17, fontWeight: 400, italic: false, code: true },
    ])).toBe('`const value = 1`');
  });

  it('applies section operations and derives a fallback title', () => {
    expect(applyNotePatch('## Context\nold\n\n## End\nlast', [
      { type: 'replaceSection', sectionId: 'context', markdown: 'new' },
      { type: 'appendSection', heading: 'Next', markdown: '- item' },
    ])).toBe('## Context\nnew\n## End\nlast\n\n## Next\n\n- item');
    expect(deriveNoteTitle('', '\n# **Native Notes**\nBody')).toBe('Native Notes');
  });

  it('keeps newer local keystrokes when an older remote save completes', () => {
    const sent = {
      noteId: 'local:1', title: 'Sent', markdown: 'first', baseRevision: 0, localVersion: 2,
      updatedAt: 100, syncState: 'saving' as const, mutationId: 'm1',
    };
    const current = {
      noteId: 'local:1', title: 'Current', markdown: 'first plus more', baseRevision: 0, localVersion: 3,
      updatedAt: 120, syncState: 'dirty' as const, mutationId: 'm1',
    };
    const saved = {
      id: 'note-1', title: 'Sent', kind: 'thought' as const, status: 'inbox' as const, markdown: 'first',
      createdAt: 90, updatedAt: 110, capturedVia: { channel: 'harmony' }, remoteVersion: 4,
    };
    expect(reconcileNoteSave(sent, current, saved, 'm2')).toEqual({
      draft: {
        noteId: 'note-1', title: 'Current', markdown: 'first plus more', baseRevision: 4, localVersion: 3,
        updatedAt: 120, syncState: 'dirty', mutationId: 'm2',
      },
      needsSync: true,
    });
  });

  it('marks the acknowledged remote version clean when no newer edit exists', () => {
    const sent = {
      noteId: 'note-1', title: 'Title', markdown: 'body', baseRevision: 3, localVersion: 4,
      updatedAt: 100, syncState: 'saving' as const, mutationId: 'm1',
    };
    const saved = {
      id: 'note-1', title: 'Title', kind: 'thought' as const, status: 'inbox' as const, markdown: 'body',
      createdAt: 90, updatedAt: 120, capturedVia: { channel: 'harmony' }, remoteVersion: 4, localVersion: 4,
    };
    expect(reconcileNoteSave(sent, sent, saved, 'm2')).toMatchObject({
      draft: { noteId: 'note-1', baseRevision: 4, localVersion: 4, syncState: 'clean' }, needsSync: false,
    });
  });
});
