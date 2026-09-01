import { describe, expect, it } from 'vitest';

import { McpOAuthSession } from '../oauth/mcp-oauth-session.js';

describe('McpOAuthSession', () => {
  it('accepts one callback with matching state without letting a bad callback cancel the session', async () => {
    const session = new McpOAuthSession('private', new URL('https://mcp.example.com/api'));
    await session.start();

    try {
      const badCallback = new URL(session.redirectUrl);
      badCallback.searchParams.set('state', 'wrong');
      badCallback.searchParams.set('code', 'attacker-code');
      expect((await fetch(badCallback)).status).toBe(400);
      expect(session.snapshot().status).toBe('starting');

      const callback = new URL(session.redirectUrl);
      callback.searchParams.set('state', session.state);
      callback.searchParams.set('code', 'authorization-code');
      expect((await fetch(callback)).status).toBe(200);
      await expect(session.waitForCode()).resolves.toBe('authorization-code');
      expect(session.snapshot().status).toBe('exchanging_code');
    } finally {
      await session.close();
    }
  });
});
