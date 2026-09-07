import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), slash: vi.fn() }));
vi.mock('../../../session/index.js', () => ({
  initSessionTurn: async ({ body }: { body: string }) => ({ bodyStripped: body }),
}));
vi.mock('../direct-turn-helpers.js', () => ({
  hydratePerTurnState: async () => undefined,
  tryRunSlashCommand: mocks.slash,
  runDirectAgentTurn: mocks.run,
}));
vi.mock('../build-direct-message-content.js', () => ({
  buildDirectUserMessageContent: async () => ({ role: 'user', content: 'hello', timestamp: 1 }),
}));

import { runProcessDirect, type RunProcessDirectDeps } from '../process-direct-one-shot.js';

describe('one-shot turn outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.slash.mockResolvedValue({ matched: false });
  });

  function setup() {
    const onTurnComplete = vi.fn();
    const endDirectRequestContext = vi.fn();
    const deps = {
      resolveSessionEndpoint: async () => ({ channel: 'automation', chatId: 'run' }),
      initSessionContext: vi.fn(),
      prepareInboundAttachments: async () => undefined,
      sessionStore: { appendTranscriptMessage: vi.fn(), updateMetadata: vi.fn() },
      agentManager: {
        prepareSkillTurn: () => ({ text: 'hello', activatedCapabilityNames: [] }),
        withSkillCapabilities: (_key: string, _names: string[], run: () => unknown) => run(),
      },
      onTurnComplete,
      endDirectRequestContext,
    } as unknown as RunProcessDirectDeps;
    return { deps, onTurnComplete, endDirectRequestContext };
  }

  it('propagates returned failures instead of reporting an empty success', async () => {
    mocks.run.mockResolvedValue({ ok: false, errorMessage: 'Model attempt budget exhausted' });
    const { deps, endDirectRequestContext } = setup();
    await expect(runProcessDirect(deps, {
      content: 'hello', sessionKey: 'agent:main:automation:run',
      origin: { type: 'system', source: 'automation' },
    })).rejects.toThrow('Model attempt budget exhausted');
    expect(endDirectRequestContext).toHaveBeenCalledOnce();
  });

  it('runs title completion even when a successful turn has no final text', async () => {
    mocks.run.mockResolvedValue({ ok: true });
    const { deps, onTurnComplete } = setup();
    await expect(runProcessDirect(deps, {
      content: 'hello', sessionKey: 'agent:main:automation:run',
      origin: { type: 'system', source: 'automation' },
    })).resolves.toBe('');
    expect(onTurnComplete).toHaveBeenCalledWith('agent:main:automation:run', undefined);
  });

  it('reveals automation command sessions after persisting their reply', async () => {
    mocks.slash.mockResolvedValue({ matched: true, aggregatedText: 'Command completed' });
    const { deps, onTurnComplete } = setup();
    const sessionKey = 'agent:main:automation:run';
    await expect(runProcessDirect(deps, {
      content: '/status', sessionKey, origin: { type: 'system', source: 'automation' },
    })).resolves.toBe('Command completed');
    expect(deps.sessionStore.appendTranscriptMessage).toHaveBeenCalledOnce();
    expect(deps.sessionStore.updateMetadata).toHaveBeenCalledWith(sessionKey, { hiddenFromSessionList: false });
    expect(onTurnComplete).toHaveBeenCalledWith(sessionKey, 'Command completed');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
