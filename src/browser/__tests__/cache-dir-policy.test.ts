import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkCacheDir } from '../cache-dir-policy.js';

describe('checkCacheDir', () => {
  it('allows undefined/empty inputs', () => {
    expect(checkCacheDir(undefined).ok).toBe(true);
    expect(checkCacheDir(null).ok).toBe(true);
    expect(checkCacheDir('').ok).toBe(true);
    expect(checkCacheDir('   ').ok).toBe(true);
  });

  it('accepts ~/ paths', () => {
    const r = checkCacheDir('~/.xopc/bin');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toBe(join(homedir(), '.xopc', 'bin'));
  });

  it('accepts absolute paths under home', () => {
    const r = checkCacheDir(join(homedir(), 'my-cache'));
    expect(r.ok).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(checkCacheDir('relative/path').ok).toBe(false);
  });

  it('rejects paths outside home', () => {
    expect(checkCacheDir('/etc/xopc').ok).toBe(false);
    expect(checkCacheDir('/tmp/xopc').ok).toBe(false);
  });

  it('rejects ../ escape attempts', () => {
    const r = checkCacheDir('~/../etc');
    expect(r.ok).toBe(false);
  });
});
