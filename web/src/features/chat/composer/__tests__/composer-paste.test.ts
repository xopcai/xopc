import { describe, expect, it, vi } from 'vitest';

import { applyComposerPaste, resolveComposerPaste } from '@/features/chat/composer/composer-paste';

function clipboard(text: string): DataTransfer {
  return {
    files: { length: 0, item: () => null },
    items: [],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as unknown as DataTransfer;
}

function clipboardFile(file: File): DataTransfer {
  return {
    files: { length: 1, item: () => file },
    items: [],
    getData: () => '',
  } as unknown as DataTransfer;
}

describe('composer paste pipeline', () => {
  it('resolves short text for inline insertion', () => {
    expect(resolveComposerPaste(clipboard('hello'))).toEqual({
      kind: 'inline-text',
      text: 'hello',
    });
  });

  it('resolves large code as a text attachment', () => {
    const code = `const value = 1;\n${'return value;\n'.repeat(25)}`;
    expect(resolveComposerPaste(clipboard(code))).toMatchObject({
      kind: 'text-attachment',
      attachment: { text: code, name: 'pasted-code.txt' },
    });
  });

  it('resolves supported and unsupported clipboard files', () => {
    const image = new File(['image'], 'screen.png', { type: 'image/png' });
    const binary = new File(['binary'], 'archive.bin', { type: 'application/octet-stream' });

    expect(resolveComposerPaste(clipboardFile(image))).toEqual({
      kind: 'files',
      files: [image],
    });
    expect(resolveComposerPaste(clipboardFile(binary))).toEqual({
      kind: 'unsupported-files',
    });
  });

  it('applies exactly one resolved action', async () => {
    const insertText = vi.fn();
    const processFiles = vi.fn(async () => {});
    const processPastedText = vi.fn(async () => {});
    const onUnsupportedFiles = vi.fn();

    await applyComposerPaste(
      { kind: 'inline-text', text: 'hello' },
      { insertText, processFiles, processPastedText, onUnsupportedFiles },
    );

    expect(insertText).toHaveBeenCalledWith('hello');
    expect(processFiles).not.toHaveBeenCalled();
    expect(processPastedText).not.toHaveBeenCalled();
    expect(onUnsupportedFiles).not.toHaveBeenCalled();
  });
});
