import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewaySseBackend } from '../backends/gateway-sse-backend.js';
import {
  formatSessionAge,
  formatSessionPickerDescription,
  sessionMetadataToTuiItem,
  shortenSessionPath,
} from '../tui-session-format.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatSessionAge', () => {
  it('returns compact relative labels', () => {
    const now = Date.now();
    expect(formatSessionAge(now - 30_000)).toBe('now');
    expect(formatSessionAge(now - 120_000)).toBe('2m');
  });
});

describe('formatSessionPickerDescription', () => {
  it('joins metadata fields', () => {
    const text = formatSessionPickerDescription({
      key: 'webchat:dm:1',
      updatedAt: Date.now() - 3_600_000,
      messageCount: 4,
      totalTokens: 1200,
      model: 'anthropic/claude',
    });
    expect(text).toContain('1h');
    expect(text).toContain('4 msgs');
    expect(text).toContain('anthropic/claude');
  });

  it('shows cwd and key only when path details are enabled', () => {
    const session = {
      key: 'agent:main:webchat:default:direct:1',
      updatedAt: Date.now() - 3_600_000,
      messageCount: 4,
      cwd: '/tmp/work',
    };

    expect(formatSessionPickerDescription(session)).not.toContain('/tmp/work');
    const detailed = formatSessionPickerDescription(session, { showKey: true });
    expect(detailed).toContain('/tmp/work');
    expect(detailed).toContain('agent:main:webchat:default:direct:1');
  });
});

describe('shortenSessionPath', () => {
  it('shortens paths under HOME', () => {
    const home = process.env.HOME;
    if (!home) return;

    expect(shortenSessionPath(`${home}/project`)).toBe('~/project');
  });
});

describe('sessionMetadataToTuiItem', () => {
  it('carries fork lineage metadata', () => {
    const item = sessionMetadataToTuiItem({
      key: 'agent:main:fork',
      status: 'active',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      messageCount: 1,
      estimatedTokens: 10,
      compactedCount: 0,
      sourceChannel: 'webchat',
      sourceChatId: 'fork',
      customData: { forkedFromSessionKey: 'agent:main:main' },
    });

    expect(item.forkedFromSessionKey).toBe('agent:main:main');
  });
});

describe('GatewaySseBackend session list mapping', () => {
  it('carries cwd into TUI session items for remote session scope/search parity', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                key: 'agent:main:remote',
                name: 'Remote session',
                updatedAt: '2026-01-01T00:00:00.000Z',
                estimatedTokens: 42,
                messageCount: 2,
                customData: { model: 'openai/gpt-4.1' },
                cwd: '/tmp/remote-work',
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const backend = new GatewaySseBackend({
      url: 'http://gateway.test',
      credential: { kind: 'token', value: 'tok' },
    });
    const sessions = await backend.listSessions();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://gateway.test/api/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
    expect(sessions[0]).toMatchObject({
      key: 'agent:main:remote',
      displayName: 'Remote session',
      cwd: '/tmp/remote-work',
      model: 'openai/gpt-4.1',
    });
  });

  it('normalizes /api/models composite ids for TUI provider/model formatting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              payload: {
                models: [
                  {
                    id: 'openai/gpt-5',
                    name: 'GPT-5',
                    provider: 'openai',
                    contextWindow: 400000,
                  },
                ],
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const backend = new GatewaySseBackend({ url: 'http://gateway.test' });
    await expect(backend.listModels()).resolves.toEqual([
      {
        id: 'gpt-5',
        name: 'GPT-5',
        provider: 'openai',
        contextWindow: 400000,
      },
    ]);
  });
});
