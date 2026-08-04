import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DoctorContext } from '../../types.js';
import { checkImageProviders } from '../image-providers.js';

const context: DoctorContext = {
  configPath: '/unused/xopc.json',
  stateDir: '/unused',
  options: { fix: false, json: false, deep: false, security: false },
};

async function writeModelsJson(imageGeneration: Record<string, unknown>): Promise<void> {
  const stateDir = await mkdtemp(join(tmpdir(), 'xopc-image-doctor-'));
  vi.stubEnv('XOPC_STATE_DIR', stateDir);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'models.json'), JSON.stringify({
    providers: {
      local: {
        baseUrl: 'http://127.0.0.1:8080/v1',
        imageGeneration,
      },
    },
  }));
}

afterEach(() => vi.unstubAllEnvs());

describe('checkImageProviders', () => {
  it('reports a private endpoint that is not explicitly allowed', async () => {
    await writeModelsJson({
      api: 'openai-images',
      name: 'Local',
      defaultModel: 'image-1',
      auth: { type: 'none' },
      models: [{ id: 'image-1', capabilities: { generate: { maxCount: 1 } } }],
    });

    await expect(checkImageProviders(context)).resolves.toMatchObject({
      status: 'fail',
      message: expect.stringContaining('blocked by private-network policy'),
    });
  });

  it('passes a no-auth private endpoint with an exact host allowlist', async () => {
    await writeModelsJson({
      api: 'openai-images',
      name: 'Local',
      defaultModel: 'image-1',
      auth: { type: 'none' },
      network: { allowedHosts: ['127.0.0.1'] },
      models: [{ id: 'image-1', capabilities: { generate: { maxCount: 1 } } }],
    });

    await expect(checkImageProviders(context)).resolves.toMatchObject({
      status: 'pass',
      message: '1 custom image provider(s) validate and are ready.',
    });
  });
});
