import { describe, expect, it, vi } from 'vitest';

import { ManagedComposioClient, inspectManagedComposioStatus } from '../composio-managed-client.js';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe('ManagedComposioClient', () => {
  it('uses the XOPC token and maps managed session operations to narrow routes', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer cloud-token');
      if (url.endsWith('/connectors/composio/toolkits/gmail/tools?query=latest%20mail')) {
        return json({ result: { toolSchemas: { send: { toolSlug: 'GMAIL_SEND_EMAIL' } } } });
      }
      if (url.endsWith('/connectors/composio/execute')) {
        expect(init?.method).toBe('POST');
        expect(new Headers(init.headers).get('idempotency-key')).toBeTruthy();
        expect(JSON.parse(String(init.body))).toEqual({
          toolkit: 'gmail', toolSlug: 'GMAIL_SEND_EMAIL', args: { to: 'a@example.test' }, accountId: 'account_1',
        });
        return json({ result: { successful: true } });
      }
      return json({ items: [] });
    });
    const client = new ManagedComposioClient({
      fetchImpl: fetchImpl as typeof fetch,
      routerUrl: 'https://router.test/v1',
      credentials: { resolveApiKey: vi.fn(async () => 'cloud-token') },
    });
    const session = await client.sessions.create('ignored-local-principal', {
      toolkits: { enable: ['gmail'] },
      connectedAccounts: { gmail: ['account_1'] },
    });
    await expect(session.search({ query: 'latest mail' })).resolves.toMatchObject({ toolSchemas: { send: { toolSlug: 'GMAIL_SEND_EMAIL' } } });
    await expect(session.execute('GMAIL_SEND_EMAIL', { to: 'a@example.test' })).resolves.toEqual({ successful: true });
  });

  it('aggregates Gmail and Slack tool catalogs in a managed search session', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/gmail/tools?query=messages')) {
        return json({ result: { toolSchemas: { GMAIL_FETCH_EMAILS: { description: 'Fetch email' } } } });
      }
      if (String(input).endsWith('/slack/tools?query=messages')) {
        return json({ result: { toolSchemas: { SLACK_SEARCH_MESSAGES: { description: 'Search messages' } } } });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const client = new ManagedComposioClient({
      fetchImpl: fetchImpl as typeof fetch,
      routerUrl: 'https://router.test/v1',
      credentials: { resolveApiKey: vi.fn(async () => 'cloud-token') },
    });
    const session = await client.sessions.create('owner', { toolkits: { enable: ['gmail', 'slack', 'gmail'] } });
    await expect(session.search({ query: 'messages' })).resolves.toEqual({ toolSchemas: {
      GMAIL_FETCH_EMAILS: { description: 'Fetch email' },
      SLACK_SEARCH_MESSAGES: { description: 'Search messages' },
    } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(session.execute('GMAIL_FETCH_EMAILS')).rejects.toThrow('exactly one toolkit');
  });

  it('preserves managed HTTP errors when one catalog request fails', async () => {
    const client = new ManagedComposioClient({
      fetchImpl: vi.fn(async (input: string | URL | Request) => String(input).endsWith('/slack/tools?query=messages')
        ? json({ error: { message: 'Slack unavailable', code: 'toolkit_unavailable' } }, 503)
        : json({ result: { toolSchemas: {} } })) as typeof fetch,
      routerUrl: 'https://router.test/v1',
      credentials: { resolveApiKey: vi.fn(async () => 'cloud-token') },
    });
    const session = await client.sessions.create('owner', { toolkits: { enable: ['gmail', 'slack'] } });
    await expect(session.search({ query: 'messages' })).rejects.toMatchObject({
      code: 'toolkit_unavailable', status: 503,
    });
  });

  it('requires renewed XOPC consent when connector scopes are absent', async () => {
    const status = await inspectManagedComposioStatus({
      routerUrl: 'https://router.test/v1',
      credentials: { resolveApiKey: vi.fn(async () => 'old-token') },
      fetchImpl: vi.fn(async () => json({
        error: { message: 'Insufficient token scope', code: 'insufficient_scope' },
      }, 403)) as typeof fetch,
    });
    expect(status).toEqual({ configured: false, mode: 'managed', reason: 'reauthorization_required' });
  });

  it('does not send custom project auth config IDs to the managed project', async () => {
    const client = new ManagedComposioClient({
      credentials: { resolveApiKey: vi.fn(async () => 'cloud-token') },
    });
    await expect(client.sessions.create('ignored', {
      toolkits: { enable: ['twitter'] }, authConfigs: { twitter: 'project-auth-config' },
    })).rejects.toThrow('require BYOK mode');
  });
});
