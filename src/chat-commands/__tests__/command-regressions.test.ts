import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { commandRegistry } from '../registry.js';
import { registerConfigCommand, redactConfigForDisplay } from '../builtins/config.js';
import { registerSessionCommands } from '../builtins/session.js';
import { registerTTSCommands } from '../builtins/tts.js';
import type { CommandContext } from '../types.js';

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  const config = ConfigSchema.parse({});
  return {
    conversationId: 'conversation-1',
    source: 'webui',
    channelId: 'webchat',
    chatId: 'chat-1',
    senderId: 'user-1',
    isGroup: false,
    config,
    reply: vi.fn(),
    replyComponent: vi.fn(),
    setTyping: vi.fn(),
    getSession: vi.fn(async () => []),
    clearSession: vi.fn(),
    resetSession: vi.fn(),
    archiveSession: vi.fn(),
    listSessions: vi.fn(async () => []),
    switchSession: vi.fn(),
    getCurrentModel: vi.fn(() => 'test/model'),
    listModels: vi.fn(async () => []),
    switchModel: vi.fn(async () => true),
    getUsage: vi.fn(async () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, messageCount: 0 })),
    supports: vi.fn(() => false),
    getConfig: vi.fn(() => config),
    updateConfig: vi.fn(async () => true),
    ...overrides,
  } as CommandContext;
}

describe('command regressions', () => {
  beforeEach(() => commandRegistry.clear());
  afterEach(() => commandRegistry.clear());

  it('recursively redacts configuration secrets', () => {
    const redacted = redactConfigForDisplay({
      channels: { telegram: { accounts: { default: { botToken: 'bot-secret' } } } },
      messages: { tts: { providers: { openai: { apiKey: 'tts-secret' } } } },
      mcp: { servers: { demo: { env: { SERVICE_TOKEN: 'env-secret' } } } },
      safe: 'visible',
    });
    expect(redacted).toEqual(expect.objectContaining({ safe: 'visible' }));
    expect(JSON.stringify(redacted)).not.toContain('bot-secret');
    expect(JSON.stringify(redacted)).not.toContain('tts-secret');
    expect(JSON.stringify(redacted)).not.toContain('env-secret');
  });

  it('blocks config reads from an unauthorized group sender', async () => {
    registerConfigCommand();
    const config = ConfigSchema.parse({ channels: { telegram: { enabled: true } } });
    const result = await commandRegistry.execute('config', context({
      source: 'telegram',
      channelId: 'telegram',
      isGroup: true,
      config,
      getConfig: () => config,
    }), 'show');
    expect(result.success).toBe(false);
    expect(result.content).toContain('not allowed');
  });

  it('writes TTS settings to the current messages.tts schema', async () => {
    registerTTSCommands();
    const config = ConfigSchema.parse({ messages: { tts: { enabled: false, provider: 'edge', trigger: 'off' } } });
    const updateConfig = vi.fn(async () => true);
    const ctx = context({ config, getConfig: () => config, updateConfig });

    await commandRegistry.execute('tts', ctx, 'on');
    await commandRegistry.execute('tts', ctx, 'provider openai');
    await commandRegistry.execute('tts', ctx, 'voice alloy');

    expect(updateConfig).toHaveBeenCalledWith('messages.tts.enabled', true);
    expect(updateConfig).toHaveBeenCalledWith('messages.tts.provider', 'openai');
    expect(updateConfig).toHaveBeenCalledWith('messages.tts.providers.edge.voice', 'alloy');
  });

  it('clears a session by resetting in place and keeps archive unavailable in webchat', async () => {
    registerSessionCommands();
    const resetSession = vi.fn(async () => undefined);
    const archiveSession = vi.fn(async () => undefined);
    const ctx = context({ resetSession, archiveSession });

    const cleared = await commandRegistry.execute('clear', ctx, '');
    const archived = await commandRegistry.execute('archive', ctx, '');

    expect(cleared.success).toBe(true);
    expect(resetSession).toHaveBeenCalledOnce();
    expect(archived.success).toBe(false);
    expect(archiveSession).not.toHaveBeenCalled();
  });
});
