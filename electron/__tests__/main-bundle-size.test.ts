import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const mainChunksDir = join(process.cwd(), 'out/main/chunks');

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
});
