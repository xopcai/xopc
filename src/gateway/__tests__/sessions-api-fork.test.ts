import { describe, expect, it, vi } from 'vitest';

import { GatewaySessionsApi } from '../service/sessions-api.js';
import type { SessionIndex } from '../../session/index.js';

describe('GatewaySessionsApi.forkAtTurn', () => {
  it('generates a fresh webchat key and routing metadata on the server', async () => {
    const sourceKey = "186828a5-4b36-42e0-85cc-6cd0114bd4c7";
    const forkSessionAtTurn = vi.fn(async (_sourceKey, options) => ({
      conversationId: options.targetKey,
      rowCount: 2,
      lastTurnId: options.lastTurnId,
    }));
    const getSessionMetadata = vi.fn(async (key: string) => key === sourceKey
      ? {
          key,
          sessionType: 'chat',
          routing: { agentId: 'main' },
        }
      : null);
    const getSession = vi.fn(async (key: string) => ({ key, messages: [] }));
    const sessionIndex = {
      getSessionMetadata,
      forkSessionAtTurn,
      getSession,
    } as unknown as SessionIndex;
    const api = new GatewaySessionsApi({
      sessionIndex,
      getAgentService: () => { throw new Error('not used'); },
      getActiveWebchatRunId: () => undefined,
      listActiveWebchatRuns: () => [],
    });

    const result = await api.forkAtTurn(sourceKey, 'turn-1');

    expect(result.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.conversationId).not.toBe(sourceKey);
    const options = forkSessionAtTurn.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      targetKey: result.conversationId,
      lastTurnId: 'turn-1',
      targetMetadata: {
        sourceChannel: 'webchat',
        sessionType: 'chat',
        routing: {
          agentId: 'main',
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
        },
      },
    });
    expect(options.targetMetadata.routing.peerId).toMatch(/^chat_/);
  });

  it('rejects the active turn before creating a target session', async () => {
    const sourceKey = "186828a5-4b36-42e0-85cc-6cd0114bd4c7";
    const forkSessionAtTurn = vi.fn();
    const sessionIndex = {
      getSessionMetadata: async () => ({
        key: sourceKey,
        sessionType: 'chat',
        routing: { agentId: 'main' },
      }),
      forkSessionAtTurn,
    } as unknown as SessionIndex;
    const api = new GatewaySessionsApi({
      sessionIndex,
      getAgentService: () => { throw new Error('not used'); },
      getActiveWebchatRunId: () => 'turn-running',
      listActiveWebchatRuns: () => [],
    });

    await expect(api.forkAtTurn(sourceKey, 'turn-running'))
      .rejects.toThrow('still running');
    expect(forkSessionAtTurn).not.toHaveBeenCalled();
  });
});
