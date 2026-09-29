import { afterEach, expect, it, vi } from 'vitest';

import { fetchRegistry } from '../marketplace.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('discovers verified Agent Plugin packages alongside native extensions', async () => {
  vi.stubEnv('XOPC_SKILLS_STORE_URL', 'https://store.example.com');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const items = url.includes('type=plugin') ? [{
      name: 'data-toolkit', description: 'Local data tools', latestVersion: '1.0.0',
      author: { username: 'XOPC Plugins' }, publisher: { verification: 'verified' },
    }] : [{
      name: 'native-demo', description: 'Native extension', latestVersion: '2.0.0',
      author: { username: 'community' }, publisher: { verification: 'community' },
    }];
    return new Response(JSON.stringify({ items }), { status: 200 });
  }));

  await expect(fetchRegistry(true)).resolves.toMatchObject({
    extensions: [
      { id: 'data-toolkit', packageType: 'plugin', verified: true },
      { id: 'native-demo', packageType: 'extension', verified: false },
    ],
  });
});
