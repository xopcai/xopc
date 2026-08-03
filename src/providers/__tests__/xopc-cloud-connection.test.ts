import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { XopcCloudConnectionService } from '../xopc-cloud-connection.js';

describe('XopcCloudConnectionService', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function paths() {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-cloud-connect-'));
    directories.push(directory);
    return {
      deviceIdPath: join(directory, 'device.json'),
      modelsJsonPath: join(directory, 'models.json'),
    };
  }

  it('uses PKCE, stores the credential outside models.json, and refreshes models', async () => {
    const local = paths();
    const savedKeys: string[] = [];
    const refreshModels = vi.fn();
    let tokenPolls = 0;
    let catalogCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/connect/requests')) {
        const request = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(request.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(request.deviceId.length).toBeGreaterThanOrEqual(16);
        return Response.json({
          requestId: 'r'.repeat(43),
          authorizationUrl: `https://console.test/connect/models?request=${'r'.repeat(43)}`,
          expiresIn: 300,
          pollInterval: 2,
        }, { status: 201 });
      }
      if (url.endsWith('/connect/token')) {
        tokenPolls += 1;
        const request = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(request.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        if (tokenPolls === 1) return Response.json({ status: 'pending' }, { status: 202 });
        return Response.json({ providerId: 'xopc-cloud', apiKey: 'xopc_model_secret' });
      }
      if (url.endsWith('/catalog')) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer xopc_model_secret');
        catalogCalls += 1;
        if (catalogCalls > 1) {
          expect(new Headers(init?.headers).get('if-none-match')).toBe('"catalog-1"');
          return new Response(null, { status: 304 });
        }
        return Response.json({
          recommendedModel: 'MiniMax-M2.1',
          models: [{ id: 'MiniMax-M2.1', name: 'MiniMax M2.1', maxOutputTokens: 8192 }],
        }, { headers: { etag: '"catalog-1"' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const service = new XopcCloudConnectionService({
      ...local,
      consoleUrl: 'https://console.test',
      routerUrl: 'https://router.test/v1',
      fetchImpl,
      refreshModels,
      credentials: {
        saveApiKey: async (_provider, key) => { savedKeys.push(key); },
        revealGatewayStoredApiKey: async () => savedKeys.at(-1) ?? null,
        deleteProfile: async () => undefined,
      },
    });

    const started = await service.start('electron');
    expect((await service.poll(started.requestId)).status).toBe('pending');
    expect(await service.poll(started.requestId)).toMatchObject({
      status: 'connected',
      models: ['MiniMax-M2.1'],
      recommendedModel: 'MiniMax-M2.1',
    });
    expect(savedKeys).toEqual(['xopc_model_secret']);
    expect(refreshModels).toHaveBeenCalledOnce();

    const modelsJson = readFileSync(local.modelsJsonPath, 'utf8');
    expect(modelsJson).toContain('MiniMax-M2.1');
    expect(modelsJson).not.toContain('xopc_model_secret');
    expect(modelsJson).not.toContain('apiKey');
    expect(await service.refreshCatalog()).toEqual({ status: 'unchanged' });
  });

  it('rejects an authorization URL outside the configured Console origin', async () => {
    const service = new XopcCloudConnectionService({
      ...paths(),
      consoleUrl: 'https://console.test',
      fetchImpl: async () => Response.json({
        requestId: 'r'.repeat(43),
        authorizationUrl: 'https://attacker.test/connect',
      }),
    });
    await expect(service.start('web')).rejects.toThrow('unsafe authorization URL');
  });
});
