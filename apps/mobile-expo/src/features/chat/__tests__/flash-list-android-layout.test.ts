import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('FlashList Android layout patch', () => {
  it('keeps the absolute row container out of Fabric view flattening', () => {
    const packageEntry = require.resolve('@shopify/flash-list');
    const collectionPath = join(dirname(packageEntry), 'recyclerview', 'ViewHolderCollection.js');
    const source = readFileSync(collectionPath, 'utf8');

    expect(source).toContain('collapsable: false');
  });
});
