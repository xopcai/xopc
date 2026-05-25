import { describe, expect, it } from 'vitest';

import { collectClipboardFiles, isComposerAcceptableFile } from '@/features/chat/composer/chat-composer';

function fileListFrom(files: File[]): FileList {
  return {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    *[Symbol.iterator]() {
      for (const f of files) {
        yield f;
      }
    },
  } as FileList;
}

function mockDataTransfer(parts: { files?: File[]; itemGetters?: Array<() => File | null> }): DataTransfer {
  const files = fileListFrom(parts.files ?? []);
  const itemGetters = parts.itemGetters ?? [];
  const items = itemGetters.map((getAsFile) => ({
    kind: 'file' as const,
    getAsFile,
  }));
  return {
    files,
    items: items as unknown as DataTransferItemList,
  } as DataTransfer;
}

describe('isComposerAcceptableFile', () => {
  it('accepts image/* by mime', () => {
    expect(isComposerAcceptableFile(new File(['x'], 'x.png', { type: 'image/png' }))).toBe(true);
    expect(isComposerAcceptableFile(new File(['x'], 'x.webp', { type: 'image/webp' }))).toBe(true);
  });

  it('accepts application/pdf by mime', () => {
    expect(isComposerAcceptableFile(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))).toBe(true);
  });

  it('accepts listed extensions when mime is empty', () => {
    expect(isComposerAcceptableFile(new File(['x'], 'notes.md', { type: '' }))).toBe(true);
    expect(isComposerAcceptableFile(new File(['x'], 'data.json', { type: '' }))).toBe(true);
  });

  it('rejects unsupported mime and extension', () => {
    expect(
      isComposerAcceptableFile(new File(['x'], 'a.bin', { type: 'application/octet-stream' })),
    ).toBe(false);
    expect(isComposerAcceptableFile(new File(['x'], 'a.exe', { type: '' }))).toBe(false);
  });
});

describe('collectClipboardFiles', () => {
  it('returns empty when data is null', () => {
    expect(collectClipboardFiles(null)).toEqual([]);
    expect(collectClipboardFiles(undefined)).toEqual([]);
  });

  it('skips zero-size files', () => {
    const empty = new File([], 'empty.txt', { type: 'text/plain' });
    const dt = mockDataTransfer({ itemGetters: [() => empty] });
    expect(collectClipboardFiles(dt)).toEqual([]);
  });

  it('dedupes identical files from items', () => {
    const a = new File(['ab'], 'note.txt', { type: 'text/plain', lastModified: 42 });
    const b = new File(['ab'], 'note.txt', { type: 'text/plain', lastModified: 42 });
    const dt = mockDataTransfer({
      itemGetters: [() => a, () => b],
    });
    const got = collectClipboardFiles(dt);
    expect(got).toHaveLength(1);
    expect(got[0]?.name).toBe('note.txt');
  });

  it('merges files list and items with dedupe', () => {
    const f = new File(['hi'], 'same.txt', { type: 'text/plain', lastModified: 7 });
    const dt = mockDataTransfer({
      files: [f],
      itemGetters: [() => f],
    });
    const got = collectClipboardFiles(dt);
    expect(got).toHaveLength(1);
    expect(got[0]?.name).toBe('same.txt');
  });

  it('dedupes same bytes from files and items when lastModified differs (browser paste quirk)', () => {
    const fromFiles = new File(['x'], 'image.png', { type: 'image/png', lastModified: 1 });
    const fromItems = new File(['x'], 'image.png', { type: 'image/png', lastModified: 2 });
    const dt = mockDataTransfer({
      files: [fromFiles],
      itemGetters: [() => fromItems],
    });
    const got = collectClipboardFiles(dt);
    expect(got).toHaveLength(1);
  });
});
