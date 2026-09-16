import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("85608543-581f-433f-8d90-f87cfa56371f", '', {"agentId":"main","sourceChannel":"subagent","sourceChatId":"task-1","sessionType":"workflow-subagent","routing":{"agentId":"main","source":"subagent","accountId":"default","peerKind":"direct","peerId":"task-1"}});
  ensureFixtureConversation("c07099de-c459-4f99-8d37-4e2838b5515c", '', {"agentId":"main","sourceChannel":"cron","sourceChatId":"job-1","sessionType":"cron","routing":{"agentId":"main","source":"cron","accountId":"default","peerKind":"direct","peerId":"job-1"}});
  ensureFixtureConversation("37479220-112e-434d-8844-19497d4f3280", '', {"agentId":"main","sourceChannel":"telegram","sourceChatId":"123","sessionType":"chat","routing":{"agentId":"main","source":"telegram","accountId":"default","peerKind":"direct","peerId":"123"}});
  ensureFixtureConversation("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", '', {"agentId":"main","sourceChannel":"cli","sourceChatId":"","sessionType":"chat","routing":{"agentId":"main","source":"cli","accountId":"default","peerKind":"direct","peerId":""}});
}
import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import {
  resolveDeliverableChannels,
  resolvePromptMode,
  resolveRuntimeChannel,
} from '../system-prompt-params.js';

describe('resolvePromptMode', () => {
  it('returns minimal for subagent and cron session keys', () => {
    seedConversationFixtures();
    expect(() => resolvePromptMode('subagent:abc')).toThrow();
    expect(resolvePromptMode("85608543-581f-433f-8d90-f87cfa56371f")).toBe('minimal');
    expect(resolvePromptMode("c07099de-c459-4f99-8d37-4e2838b5515c")).toBe('minimal');
  });

  it('returns full for normal sessions', () => {
    seedConversationFixtures();
    expect(resolvePromptMode("37479220-112e-434d-8844-19497d4f3280")).toBe('full');
    expect(resolvePromptMode(undefined)).toBe('full');
  });
});

describe('resolveRuntimeChannel', () => {
  it('extracts channel source from session key', () => {
    seedConversationFixtures();
    expect(resolveRuntimeChannel("37479220-112e-434d-8844-19497d4f3280")).toBe('telegram');
    expect(resolveRuntimeChannel("6d9217fe-77c7-411d-8cc9-92aabe81a2d0")).toBe('cli');
  });
});

describe('resolveDeliverableChannels', () => {
  it('always includes webchat and cli', () => {
    seedConversationFixtures();
    const channels = resolveDeliverableChannels({} as Config);
    expect(channels).toContain('webchat');
    expect(channels).toContain('cli');
  });

  it('includes enabled configured channel plugins', () => {
    seedConversationFixtures();
    const channels = resolveDeliverableChannels({
      channels: {
        telegram: { enabled: true, accounts: {} },
      },
    } as Config);
    expect(channels).toContain('telegram');
  });
});
