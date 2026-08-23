import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectChromiumBookmarkItems,
  sanitizeBookmarkUrl,
} from '../understanding-sources/chromium-bookmarks.js';

const CHROMIUM_EPOCH_OFFSET_MS = 11_644_473_600_000;

function chromiumTime(timestamp: number): string {
  return String(Math.round((timestamp + CHROMIUM_EPOCH_OFFSET_MS) * 1_000));
}

describe('Chromium bookmark understanding source', () => {
  const paths: string[] = [];

  afterEach(async () => {
    await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('removes paths, queries, fragments, and credentials from bookmark URLs', () => {
    expect(sanitizeBookmarkUrl('https://user:pass@example.com/private?q=token#section'))
      .toBe('https://example.com');
    expect(sanitizeBookmarkUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeBookmarkUrl('https://online-banking.example/')).toBeNull();
    expect(sanitizeBookmarkUrl('http://localhost:3000/private')).toBeNull();
    expect(sanitizeBookmarkUrl('https://192.168.1.5/dashboard')).toBeNull();
    expect(sanitizeBookmarkUrl('http://[::1]/dashboard')).toBeNull();
  });

  it('collects only recent, non-sensitive bookmark metadata from detected profiles', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-bookmarks-'));
    paths.push(home);
    const profile = join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default');
    await mkdir(profile, { recursive: true });
    const nowMs = Date.now();
    await writeFile(join(profile, 'Bookmarks'), JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bookmarks bar',
          children: [
            { type: 'url', name: 'Agent memory research alice@example.com abcdefghijklmnopqrstuvwxyz123456', url: 'https://example.com/article?secret=1', date_added: chromiumTime(nowMs - 1_000) },
            { type: 'url', name: 'Medical results', url: 'https://health.example/report', date_added: chromiumTime(nowMs - 1_000) },
            { type: 'url', name: 'Old reference', url: 'https://old.example/reference', date_added: chromiumTime(nowMs - 120 * 86_400_000) },
            { type: 'folder', name: 'Medical', children: [
              { type: 'url', name: 'Lab portal', url: 'https://example.org/report', date_added: chromiumTime(nowMs - 1_000) },
            ] },
          ],
        },
      },
    }));

    const items = await collectChromiumBookmarkItems({
      homeDirectory: home,
      platform: 'darwin',
      environment: {},
      nowMs,
    });

    expect(items).toEqual([expect.objectContaining({
      sourceId: 'chromium-bookmarks',
      type: 'bookmark',
      title: 'Agent memory research <email> <redacted>',
      resourceUri: 'https://example.com',
    })]);
    expect(JSON.stringify(items)).not.toContain('secret=1');
    expect(JSON.stringify(items)).not.toContain('alice@example.com');
    expect(JSON.stringify(items)).not.toContain(home);
  });
});
