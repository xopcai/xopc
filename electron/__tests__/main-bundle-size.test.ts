import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const mainIndex = join(process.cwd(), 'out/main/index.js');
const mainChunksDir = join(process.cwd(), 'out/main/chunks');

/** Runtime npm imports that must not appear in the main bundle (packaged asar has minimal node_modules). */
const FORBIDDEN_MAIN_EXTERNALS = ['zod', 'pino', 'dotenv', 'electron-updater'] as const;

function readMainBundleSources(): string[] {
  const sources = [readFileSync(mainIndex, 'utf8')];
  try {
    for (const name of readdirSync(mainChunksDir)) {
      if (name.endsWith('.js')) {
        sources.push(readFileSync(join(mainChunksDir, name), 'utf8'));
      }
    }
  } catch {
    /* no chunks dir */
  }
  return sources;
}

describe('electron main bundle (when out/main exists)', () => {
  it('does not ship validate-channel-configs chunk', () => {
    let names: string[];
    try {
      names = readdirSync(mainChunksDir);
    } catch {
      // Local/CI may skip electron-vite build; size check is enforced in electron-build workflow.
      return;
    }
    const channelChunk = names.filter((name) => name.includes('validate-channel-configs'));
    expect(channelChunk).toEqual([]);
  });

  it('bundles runtime npm deps instead of bare imports (packaged asar omits them)', () => {
    let sources: string[];
    try {
      sources = readMainBundleSources();
    } catch {
      return;
    }
    const combined = sources.join('\n');
    for (const pkg of FORBIDDEN_MAIN_EXTERNALS) {
      expect(combined, `main bundle must not externalize "${pkg}"`).not.toMatch(
        new RegExp(`from["']${pkg}["']`),
      );
    }
  });
});
