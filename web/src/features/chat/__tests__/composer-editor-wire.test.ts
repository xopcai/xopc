// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest';
import type { CommandEntry } from '@/features/chat/command-palette.types';
import { formatFilePathForWire } from '@/features/chat/file-wire-pattern';
import {
  applyWireToEditor,
  listSkillNamesInWire,
  normalizeOrphanComposerDom,
  removeSkillTokenAtOrBeforeCaret,
  removeTrailingSkillTokenBeforeCaret,
  serializeEditorToWire,
} from '@/features/chat/composer-editor-wire';
import { refreshSlashCommandWireIndex } from '@/features/chat/slash-command-wire';

describe('removeSkillTokenAtOrBeforeCaret', () => {
  it('removes token when caret is at end of token', () => {
    const w = '/skill:a /skill:b';
    const endB = w.length;
    expect(removeSkillTokenAtOrBeforeCaret(w, endB)).toEqual({
      wire: '/skill:a ',
      caret: 9,
    });
  });

  it('removes first token when caret inside it', () => {
    expect(removeSkillTokenAtOrBeforeCaret('/skill:foo x', 8)).toEqual({
      wire: ' x',
      caret: 0,
    });
  });
});

describe('listSkillNamesInWire', () => {
  it('collects all skill tokens', () => {
    expect([...listSkillNamesInWire('/skill:a /skill:b x')].sort()).toEqual(['a', 'b']);
  });
});

describe('removeTrailingSkillTokenBeforeCaret', () => {
  it('removes last token when caret is immediately after token (suffix match)', () => {
    const w = '/skill:a /skill:b';
    // caret one past last char of /skill:b — same as len
    expect(removeTrailingSkillTokenBeforeCaret(w, w.length)).toEqual({
      wire: '/skill:a ',
      caret: 9,
    });
  });

  it('at EOW removes token plus trailing spaces after palette-style insert', () => {
    const w = '/skill:foo ';
    expect(removeTrailingSkillTokenBeforeCaret(w, w.length)).toEqual({
      wire: '',
      caret: 0,
    });
  });

  it('does not remove skill when caret is after a separator space before more text', () => {
    const w = '/skill:foo bar';
    // Caret immediately after the space between skill and "bar"
    expect(removeTrailingSkillTokenBeforeCaret(w, '/skill:foo '.length)).toBeNull();
  });
});

const slashCmdFixtures: CommandEntry[] = [
  {
    id: 'session.clear',
    name: 'clear',
    aliases: [],
    description: '',
    category: 'session',
    acceptsArgs: true,
    examples: [],
  },
];

describe('slash command pills', () => {
  beforeEach(() => {
    refreshSlashCommandWireIndex(slashCmdFixtures);
  });

  it('round-trips /clear via pill DOM', () => {
    const root = document.createElement('div');
    applyWireToEditor(root, '/clear ');
    expect(root.querySelector('.chat-command-pill')).toBeTruthy();
    expect(serializeEditorToWire(root)).toBe('/clear ');
  });
});

describe('serializeEditorToWire', () => {
  it('inserts space between file pill and following text so wire does not merge path with typed CJK', () => {
    const root = document.createElement('div');
    applyWireToEditor(root, '@file:您的重要创意.pptx');
    const afterPill = root.childNodes[root.childNodes.length - 1];
    expect(afterPill?.nodeType).toBe(Node.TEXT_NODE);
    afterPill.textContent = (afterPill.textContent ?? '') + '分析';
    expect(serializeEditorToWire(root)).toBe('@file:您的重要创意.pptx 分析');
  });

  it('serializes file paths with spaces as quoted @file wire', () => {
    const root = document.createElement('div');
    applyWireToEditor(root, `@file:${formatFilePathForWire('Meeting Notes.docx')}`);
    expect(serializeEditorToWire(root)).toBe('@file:"Meeting Notes.docx"');
  });
});

describe('normalizeOrphanComposerDom', () => {
  it('preserves space-only content (wire non-empty; placeholder class stays off)', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode(' '));
    expect(normalizeOrphanComposerDom(root)).toBe(' ');
    expect(serializeEditorToWire(root)).toBe(' ');
    expect(root.childNodes.length).toBe(1);
  });

  it('clears ZWSP-only DOM (wire strips ZWSP but nodes could remain)', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('\u200b'));
    expect(normalizeOrphanComposerDom(root)).toBe('');
    expect(root.childNodes.length).toBe(0);
  });

  it('preserves a lone BR (wire is newline; not an orphan)', () => {
    const root = document.createElement('div');
    root.appendChild(document.createElement('br'));
    expect(normalizeOrphanComposerDom(root)).toBe('\n');
    expect(serializeEditorToWire(root)).toBe('\n');
  });

  it('preserves text with non-whitespace characters', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode(' hi '));
    expect(normalizeOrphanComposerDom(root)).toBe(' hi ');
    expect(root.childNodes.length).toBe(1);
  });
});
