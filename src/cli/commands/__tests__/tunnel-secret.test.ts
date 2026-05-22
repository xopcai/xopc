import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { saveConfig } from '../../../config/loader.js';
import { mergeTunnelConfigPatch } from '../../../tunnel/tunnel-config.js';

describe('tunnel secret config', () => {
  it('persists registrationSecret via mergeTunnelConfigPatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-tunnel-secret-cli-'));
    const configPath = join(dir, 'xopc.json');
    const config = { tunnel: { enabled: false } } as Config;

    expect(mergeTunnelConfigPatch(config, { registrationSecret: 'broker-secret' }).ok).toBe(true);
    await saveConfig(config, configPath);

    const saved = JSON.parse(readFileSync(configPath, 'utf8')) as Config;
    expect(saved.tunnel?.registrationSecret).toBe('broker-secret');

    rmSync(dir, { recursive: true, force: true });
  });
});
