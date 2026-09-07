import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resume: vi.fn(), run: vi.fn(), pending: vi.fn(), clearPending: vi.fn() }));
vi.mock('../../../storage/sqlite/connection-wait-repository.js', () => ({ getConnectionResumeInput: mocks.resume }));
vi.mock('../../../session/index.js', () => ({
  resolveConfiguredActivityDetailDefault: () => 'stream',
  resolveEffectiveReasoningLevel: async () => 'stream',
}));
vi.mock('../direct-turn-helpers.js', () => ({
  hydratePerTurnState: async () => undefined,
  tryRunSlashCommand: async () => ({ matched: false }),
  runDirectAgentTurn: mocks.run,
}));
vi.mock('../../inbound/attachment-pipeline.js', () => ({
  setPendingTranscriptUserMessage: mocks.pending,
  clearPendingTranscriptUserMessage: mocks.clearPending,
}));
vi.mock('../../../channels/attachments/voice-stt-webchat.js', () => ({
  isVoiceLikeAttachment: () => false,
  mergeVoiceTranscriptsIntoUserText: async (_attachments: unknown, text: string) => ({ text, inboundVoice: false }),
}));
vi.mock('../../../voice/stt/index.js', () => ({ mergeSttConfigFromAppConfig: () => ({}) }));

import { runProcessDirectStreaming, type ProcessDirectStreamingDeps } from '../process-direct-streaming.js';

function setup() {
  const title = vi.fn();
  const deps = {
    log: { warn: vi.fn(), info: vi.fn() },
    resolveSessionEndpoint: async () => ({ channel: 'webchat', chatId: 'chat' }),
    initDirectStreamingSession: () => ({}),
    registerWebchatStreamPublisher: vi.fn(), unregisterWebchatStreamPublisher: vi.fn(),
    endDirectRequestContext: vi.fn(), getConfig: () => undefined,
    prepareInboundAttachments: async () => undefined,
    buildTranscriptUserMessage: async (content: string) => ({ role: 'user', content, timestamp: 1 }),
    agentManager: {
      prepareSkillTurn: (_key: string, text: string) => ({ text, activatedCapabilityNames: [] }),
      withSkillCapabilities: (_key: string, _names: string[], run: () => unknown) => run(),
    },
    maybeEmitWebchatTts: async () => null,
    enqueueProvisionalSessionTitle: title,
  } as unknown as ProcessDirectStreamingDeps;
  return { deps, title };
}

describe('direct stream input visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resume.mockReturnValue(undefined);
    mocks.run.mockImplementation(async (_deps, input) => {
      input.onEvent({ type: 'message_end', message: { role: 'assistant', content: 'Resumed' } });
      return { ok: true, lastAssistantText: 'Resumed' };
    });
  });

  it.each(['continued', 'skipped'])('keeps a %s connection continuation out of user events, titles, and pending transcript rows', async resolution => {
    mocks.resume.mockReturnValue({ kind: 'connection_resume', payload: { resolution } });
    const { deps, title } = setup();
    const events = [];
    for await (const event of runProcessDirectStreaming(deps, {
      content: 'Internal recovery instruction', sessionKey: 'agent:main:main', runId: 'resume-run',
      origin: { type: 'system', source: 'internal' },
    })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['message_end']);
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(title).not.toHaveBeenCalled();
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.clearPending).not.toHaveBeenCalled();
  });

  it('still publishes and records actual user input', async () => {
    const { deps, title } = setup();
    const events = [];
    for await (const event of runProcessDirectStreaming(deps, {
      content: 'Check Gmail', sessionKey: 'agent:main:main', runId: 'user-run',
      origin: { type: 'system', source: 'internal' },
    })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['user_message', 'message_end']);
    expect(title).toHaveBeenCalledWith('agent:main:main', 'Check Gmail');
    expect(mocks.pending).toHaveBeenCalledOnce();
    expect(mocks.clearPending).toHaveBeenCalledOnce();
  });
});
