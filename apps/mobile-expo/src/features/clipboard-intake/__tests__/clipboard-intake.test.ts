import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memory } = vi.hoisted(() => ({
  memory: new Map<string, string>(),
}));

vi.mock('../../../storage/mmkv', () => ({
  KEYS: {
    clipboardHandledHashes: 'clipboard.handledHashes',
    clipboardLatestAppHash: 'clipboard.latestAppHash',
  },
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import { isLatestAppClipboardHash, rememberAppClipboardText } from '../app-clipboard-origin';
import { hashClipboardText } from '../clipboard-hash';
import {
  clearClipboardIntakeMemory,
  CLIPBOARD_HANDLED_HASH_LIMIT,
  isClipboardHashHandled,
  rememberClipboardHashHandled,
} from '../clipboard-intake-store';

beforeEach(() => {
  memory.clear();
  clearClipboardIntakeMemory();
});

describe('hashClipboardText', () => {
  it('returns a stable hash for identical text', () => {
    expect(hashClipboardText('hello')).toBe(hashClipboardText('hello'));
  });

  it('returns different hashes for different text', () => {
    expect(hashClipboardText('hello')).not.toBe(hashClipboardText('hello!'));
  });
});

describe('clipboard intake handled hashes', () => {
  it('remembers handled clipboard hashes across reads', () => {
    const hash = hashClipboardText('handled content');

    rememberClipboardHashHandled(hash, 1000);

    expect(isClipboardHashHandled(hash)).toBe(true);
    expect(isClipboardHashHandled(hashClipboardText('new content'))).toBe(false);
  });

  it('keeps only the most recent handled hashes', () => {
    for (let i = 0; i < CLIPBOARD_HANDLED_HASH_LIMIT + 5; i += 1) {
      rememberClipboardHashHandled(`hash-${i}`, i);
    }

    expect(isClipboardHashHandled('hash-0')).toBe(false);
    expect(isClipboardHashHandled(`hash-${CLIPBOARD_HANDLED_HASH_LIMIT + 4}`)).toBe(true);
  });
});

describe('app clipboard origin', () => {
  it('recognizes the latest app-written clipboard text by hash', () => {
    rememberAppClipboardText('  copied in app  ');

    expect(isLatestAppClipboardHash(hashClipboardText('copied in app'))).toBe(true);
    expect(isLatestAppClipboardHash(hashClipboardText('copied elsewhere'))).toBe(false);
  });

  it('keeps only the latest app-written clipboard hash', () => {
    rememberAppClipboardText('first copy');
    rememberAppClipboardText('second copy');

    expect(isLatestAppClipboardHash(hashClipboardText('first copy'))).toBe(false);
    expect(isLatestAppClipboardHash(hashClipboardText('second copy'))).toBe(true);
  });

  it('clears the remembered hash when app-written text is empty', () => {
    rememberAppClipboardText('copied in app');
    rememberAppClipboardText('   ');

    expect(isLatestAppClipboardHash(hashClipboardText('copied in app'))).toBe(false);
  });
});
