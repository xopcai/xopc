import { complete } from '@earendil-works/pi-ai/compat';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveModel } from '../../../providers/index.js';
import { runBtwQuery } from '../btw-query.js';

vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/compat')>();
  return { ...actual, complete: vi.fn() };
});

vi.mock('../../../providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../providers/index.js')>();
  return {
    ...actual,
    resolveModel: vi.fn(() => ({ provider: 'openai', id: 'gpt-test', api: 'openai-completions' })),
  };
});

function makeSessionStore(messages: unknown[]) {
  return {
    load: vi.fn(async () => messages),
  };
}

function makeLog() {
  return { warn: vi.fn() };
}

describe('runBtwQuery', () => {
  beforeEach(() => {
    vi.mocked(resolveModel).mockReturnValue({
      provider: 'openai',
      id: 'gpt-test',
      api: 'openai-completions',
    } as never);
    vi.mocked(complete).mockReset();
  });

  it('answers a side question using recent session messages as read-only background', async () => {
    vi.mocked(complete).mockResolvedValue({
      content: [{ type: 'text', text: 'Short answer.' }],
    } as Awaited<ReturnType<typeof complete>>);
    const sessionStore = makeSessionStore([
      { role: 'user', content: 'Build the TUI command review.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Reviewed commands.' }] },
    ]);

    const result = await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: 'what was reviewed?',
      sessionStore: sessionStore as never,
      modelForSession: 'openai/gpt-test',
      log: makeLog(),
    });

    expect(result).toEqual({ text: 'Short answer.' });
    expect(resolveModel).toHaveBeenCalledWith('openai/gpt-test');
    expect(sessionStore.load).toHaveBeenCalledWith('agent:main:main');
    const completeArgs = vi.mocked(complete).mock.calls[0];
    expect(String(completeArgs?.[1].messages[0]?.content)).toContain('Build the TUI command review.');
    expect(String(completeArgs?.[1].messages[0]?.content)).toContain('Side question:\nwhat was reviewed?');
  });

  it('accepts providers that return plain string content', async () => {
    vi.mocked(complete).mockResolvedValue({
      content: 'String answer.',
    } as Awaited<ReturnType<typeof complete>>);

    const result = await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: 'quick check',
      sessionStore: makeSessionStore([]) as never,
      modelForSession: 'openai/gpt-test',
      log: makeLog(),
    });

    expect(result).toEqual({ text: 'String answer.' });
  });

  it('passes caller token and temperature overrides to the model call', async () => {
    vi.mocked(complete).mockResolvedValue({
      content: [{ type: 'text', text: 'Longer answer.' }],
    } as Awaited<ReturnType<typeof complete>>);

    const result = await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: 'review this',
      sessionStore: makeSessionStore([]) as never,
      modelForSession: 'openai/gpt-test',
      log: makeLog(),
      maxTokens: 8192,
      temperature: 0.1,
    });

    expect(result).toEqual({ text: 'Longer answer.' });
    expect(vi.mocked(complete).mock.calls[0]?.[2]).toMatchObject({
      maxTokens: 8192,
      temperature: 0.1,
    });
  });

  it('caps caller token overrides at the model maxTokens value', async () => {
    vi.mocked(resolveModel).mockReturnValue({
      provider: 'openai',
      id: 'gpt-test',
      api: 'openai-completions',
      maxTokens: 4096,
    } as never);
    vi.mocked(complete).mockResolvedValue({
      content: [{ type: 'text', text: 'Capped answer.' }],
    } as Awaited<ReturnType<typeof complete>>);

    await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: 'review this',
      sessionStore: makeSessionStore([]) as never,
      modelForSession: 'openai/gpt-test',
      log: makeLog(),
      maxTokens: 8192,
    });

    expect(vi.mocked(complete).mock.calls[0]?.[2]).toMatchObject({
      maxTokens: 4096,
    });
  });

  it('returns an explicit error when the model returns no text content', async () => {
    vi.mocked(complete).mockResolvedValue({
      content: [],
    } as Awaited<ReturnType<typeof complete>>);

    const result = await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: 'quick check',
      sessionStore: makeSessionStore([]) as never,
      modelForSession: 'openai/gpt-test',
      log: makeLog(),
    });

    expect(result).toEqual({ text: '', error: 'No text returned from model.' });
  });

  it('returns an error for empty questions without loading the session', async () => {
    const sessionStore = makeSessionStore([]);

    const result = await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: '   ',
      sessionStore: sessionStore as never,
      modelForSession: 'openai/gpt-test',
      log: makeLog(),
    });

    expect(result).toEqual({ text: '', error: 'Empty question.' });
    expect(sessionStore.load).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('returns a model resolution error with structured warning context', async () => {
    vi.mocked(resolveModel).mockImplementation(() => {
      throw new Error('unknown model');
    });
    const log = makeLog();

    const result = await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: 'quick check',
      sessionStore: makeSessionStore([]) as never,
      modelForSession: 'missing/model',
      log,
    });

    expect(result).toEqual({ text: '', error: 'Could not resolve model: missing/model' });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ modelRef: 'missing/model', errorMessage: 'unknown model' }),
      'btwQuery: model resolve failed',
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('returns LLM failures as command errors', async () => {
    vi.mocked(complete).mockRejectedValue(new Error('provider down'));
    const log = makeLog();

    const result = await runBtwQuery({
      sessionKey: 'agent:main:main',
      question: 'quick check',
      sessionStore: makeSessionStore([]) as never,
      modelForSession: 'openai/gpt-test',
      log,
    });

    expect(result).toEqual({ text: '', error: 'provider down' });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'agent:main:main', errorMessage: 'provider down' }),
      'btwQuery failed',
    );
  });
});
