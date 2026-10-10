import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialResolver } from '../credentials.js';
import { openaiOAuthProvider } from './openai.js';

describe('OpenAI ChatGPT OAuth', () => {
  let credentialsDir: string;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    credentialsDir = await mkdtemp(join(tmpdir(), 'xopc-openai-oauth-'));
    vi.stubEnv('XOPC_CREDENTIALS_DIR', credentialsDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(credentialsDir, { recursive: true, force: true });
  });

  it('uses dynamic registration, persists its client ID and reuses the installation ID', async () => {
    const hosts: string[] = [];
    const states: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://auth.openai.com/api/accounts/oauth/token');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('client_id')).toBe('issued-client');
      expect(body.get('resource')).toBe('https://api.openai.com/v1');
      return Response.json({
        access_token: 'chatgpt-access', refresh_token: 'chatgpt-refresh', id_token: 'identity',
        expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onAuth = vi.fn(({ url }: { url: string }) => {
      const auth = new URL(url);
      expect(auth.origin + auth.pathname).toBe('https://auth.openai.com/api/accounts/authorize');
      expect(auth.searchParams.get('client_id')).toBe('dynamic_agent_client');
      expect(auth.searchParams.get('agent_name_hint')).toBe('xopc');
      hosts.push(auth.searchParams.get('ext_agent_host_id')!);
      states.push(auth.searchParams.get('state')!);
      const callback = new URL(auth.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({ code: 'code', state: states.at(-1)!, client_id: 'issued-client' }).toString();
      void realFetch(callback).catch(() => {});
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const credential = await openaiOAuthProvider.login({
        onAuth, onDeviceCode: vi.fn(), onSelect: async () => undefined,
        onPrompt: ({ signal }) => new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Prompt closed')), { once: true });
        }),
      });
      expect(credential).toMatchObject({ access: 'chatgpt-access', clientId: 'issued-client' });
      await new CredentialResolver().saveOAuthCredentials('openai', credential);
      expect(await new CredentialResolver().loadOAuthTokenRecord('openai')).toMatchObject({ clientId: 'issued-client' });
    }
    expect(hosts[0]).toBe(hosts[1]);
    expect(hosts[0]).toBe(`urn:uuid:${(await readFile(join(credentialsDir, 'openai-device-id'), 'utf8')).trim()}`);
    expect(states[0]).not.toBe(states[1]);
  });

  it('refreshes with the issued client ID and rejects credentials without it', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('client_id')).toBe('issued-client');
      return Response.json({ access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 3600, scope: 'chatgpt.tokens.use.direct' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const credential = { access: 'access', refresh: 'refresh', expires: 0, clientId: 'issued-client' };
    expect(await openaiOAuthProvider.refreshToken(credential)).toMatchObject({ clientId: 'issued-client', refresh: 'next-refresh' });
    await expect(openaiOAuthProvider.refreshToken({ access: 'old-access', refresh: 'old-refresh', expires: 0 })).rejects.toThrow('reconnect ChatGPT');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
