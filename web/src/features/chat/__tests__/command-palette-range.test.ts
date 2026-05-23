import { describe, it, expect } from 'vitest';
import type { PaletteItem } from '@/features/chat/command-palette.types';
import { detectSlashRange, paletteItemMatchRank } from '@/features/chat/use-command-palette';

describe('detectSlashRange', () => {
  it('detects active slash token before cursor', () => {
    const t = '/he';
    const r = detectSlashRange(t, t.length);
    expect(r).toEqual({ start: 0, end: 3, query: 'he' });
  });

  it('returns null when cursor is not in slash token', () => {
    expect(detectSlashRange('hello', 5)).toBeNull();
  });

  it('handles slash after newline', () => {
    const t = 'x\n/new';
    const r = detectSlashRange(t, t.length);
    expect(r).toEqual({ start: 2, end: t.length, query: 'new' });
  });

  it('treats lone slash when cursor not yet synced', () => {
    expect(detectSlashRange('/', 0)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('detects slash anywhere the user is typing / (mid-sentence)', () => {
    const t = 'hello /n';
    expect(detectSlashRange(t, t.length)).toEqual({ start: 6, end: t.length, query: 'n' });
    const zh = '你好，/';
    expect(detectSlashRange(zh, zh.length)).toEqual({ start: 3, end: zh.length, query: '' });
    const glued = '你好，/doc';
    expect(detectSlashRange(glued, glued.length)).toEqual({ start: 3, end: glued.length, query: 'doc' });
  });

  it('ignores slash tokens that look like file paths', () => {
    const path = '我想要给 xopc /Users/micjoyce/develop/github/xopc只做一个宣传片';
    expect(detectSlashRange(path, path.length)).toBeNull();
    expect(detectSlashRange('see /Users/micjoyce', 'see /Users/micjoyce'.length)).toBeNull();
    expect(detectSlashRange('open /var/log/syslog', 'open /var/log/syslog'.length)).toBeNull();
  });

  it('ignores slash inside URLs', () => {
    expect(detectSlashRange('see https://example.com/foo', 'see https://example.com/foo'.length)).toBeNull();
    expect(detectSlashRange('file foo.com/bar', 'file foo.com/bar'.length)).toBeNull();
  });

  it('returns null for wire /skill:name tokens (pill), not slash palette', () => {
    const w = '/skill:docx';
    expect(detectSlashRange(w, w.length)).toBeNull();
    const mid = 'prefix /skill:foo';
    expect(detectSlashRange(mid, mid.length)).toBeNull();
  });

  it('returns null when slash is inside @file: path (not command palette)', () => {
    const t = '@file:demo-file/月度预算.xlsx';
    expect(detectSlashRange(t, t.length)).toBeNull();
    const ascii = '@file:src/components/Button.tsx';
    expect(detectSlashRange(ascii, ascii.length)).toBeNull();
  });

  it('returns null for slash inside quoted @file: path', () => {
    const t = '@file:"a/b Meeting Notes.docx"';
    expect(detectSlashRange(t, t.length)).toBeNull();
  });
});

describe('paletteItemMatchRank', () => {
  const cmdNew: PaletteItem = {
    kind: 'command',
    id: 'cmd:new',
    name: 'new',
    description: 'Start a new session',
    category: 'session',
  };
  const skillDocx: PaletteItem = {
    kind: 'skill',
    id: 'skill:docx',
    name: 'docx',
    description: 'Create a new Word document',
    category: 'skill',
  };

  it('ranks exact name above description-only substring', () => {
    expect(paletteItemMatchRank(cmdNew, 'new')).toBe(0);
    expect(paletteItemMatchRank(skillDocx, 'new')).toBe(100);
    expect((paletteItemMatchRank(cmdNew, 'new') ?? 999) < (paletteItemMatchRank(skillDocx, 'new') ?? 999)).toBe(true);
  });

  it('ranks name prefix above description match', () => {
    const skillNet: PaletteItem = {
      kind: 'skill',
      id: 'skill:net',
      name: 'network',
      description: 'Networking help',
      category: 'skill',
    };
    const skillDescOnly: PaletteItem = {
      kind: 'skill',
      id: 'skill:x',
      name: 'zzz',
      description: 'Uses net protocol',
      category: 'skill',
    };
    expect(paletteItemMatchRank(skillNet, 'net')).toBe(2);
    expect(paletteItemMatchRank(skillDescOnly, 'net')).toBe(100);
    expect((paletteItemMatchRank(skillNet, 'net') ?? 999) < (paletteItemMatchRank(skillDescOnly, 'net') ?? 999)).toBe(
      true,
    );
  });
});
