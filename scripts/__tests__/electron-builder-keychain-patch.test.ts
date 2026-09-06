import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('electron-builder macOS keychain patch', () => {
  it('uses the temporary keychain password for set-key-partition-list', () => {
    const require = createRequire(import.meta.url);
    const packageEntry = require.resolve('app-builder-lib');
    const macCodeSign = readFileSync(join(dirname(packageEntry), 'codeSign/macCodeSign.js'), 'utf8');

    expect(macCodeSign).toContain(
      'importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)',
    );
    expect(macCodeSign).toMatch(
      /\["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile\]/,
    );
    expect(macCodeSign).toMatch(
      /\["import", paths\[i\], "-k", keychainFile, .* "-P", password\]/,
    );
  });
});
