// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/settings/agents/agent-avatar-dicebear', () => ({
  dicebearToDataUri: () => 'data:image/svg+xml,<svg/>',
}));
vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: (select: (state: { conversationId: string }) => unknown) => select({ conversationId: 'token' }),
}));
vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'zh' }),
}));

import {
  externalContextAccessLabel,
  externalRuntimeLabel,
} from '@/components/brand/external-runtime-badge';
import { resolveSessionAgentId } from '@/features/sessions/session-agent-resolve';
import { SessionCard } from '@/features/sessions/session-card';
import type { SessionMetadata } from '@/features/sessions/session.types';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { AgentStatusBadges } from '@/features/settings/agents/agent-status-badges';
import { messages } from '@/i18n/messages';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('external runtime indicators', () => {
  it('formats runtime and context access labels for codex, agy, and claude', () => {
    expect(externalRuntimeLabel('codex', 'full')).toBe('Codex');
    expect(externalRuntimeLabel('agy', 'full')).toBe('AGY');
    expect(externalRuntimeLabel('claude', 'full')).toBe('Claude Code');
    expect(externalRuntimeLabel('claude', 'short')).toBe('Claude');

    expect(externalContextAccessLabel('off', true)).toBe('上下文关闭');
    expect(externalContextAccessLabel('brief_only', true)).toBe('仅简报');
    expect(externalContextAccessLabel('read_only', true)).toBe('只读上下文');
    expect(externalContextAccessLabel('read_write', false)).toBe('Read & write context');
  });

  it('overlays runtime corner badge only on custom avatars and avoids duplicating runtime avatars', async () => {
    await act(async () => {
      root.render(
        <>
          <div data-testid="custom">
            <AgentAvatarDisplay agentId="claude-custom" avatar="https://example.com/a.png" runtimeBadge="claude" size={32} />
          </div>
          <div data-testid="brand">
            <AgentAvatarDisplay agentId="claude-brand" avatar="xopc:runtime:claude" runtimeBadge="claude" size={32} />
          </div>
        </>,
      );
    });

    expect(container.querySelector('[data-testid="custom"] [data-external-runtime-badge="claude"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="brand"] [data-external-runtime-badge="claude"]')).toBeNull();
  });

  it('renders Claude Code, Codex, and AGY badges accurately in AgentStatusBadges', async () => {
    const m = messages('en').agentsSettings;
    await act(async () => {
      root.render(
        <>
          <AgentStatusBadges agent={{ id: 'a1', isDefault: false, override: { execution: { kind: 'codex' } } }} messages={m} />
          <AgentStatusBadges agent={{ id: 'a2', isDefault: false, override: { execution: { kind: 'agy' } } }} messages={m} />
          <AgentStatusBadges agent={{ id: 'a3', isDefault: false, override: { execution: { kind: 'claude' } } }} messages={m} />
        </>,
      );
    });

    expect(container.querySelector('[data-external-runtime-pill="codex"]')?.textContent).toBe('Codex');
    expect(container.querySelector('[data-external-runtime-pill="agy"]')?.textContent).toBe('AGY');
    expect(container.querySelector('[data-external-runtime-pill="claude"]')?.textContent).toBe('Claude Code');
  });

  it('resolves session agentId from routing or direct session.agentId and renders runtime pill on SessionCard', async () => {
    const now = '2026-11-26T00:00:00.000Z';
    const session: SessionMetadata = {
      key: 'sess-claude-1',
      agentId: 'claude-dev',
      name: 'Refactor MCP bridge',
      status: 'active',
      tags: [],
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      messageCount: 4,
      estimatedTokens: 1200,
      compactedCount: 0,
      sourceChannel: 'webchat',
      sourceChatId: 'sess-claude-1',
    };

    expect(resolveSessionAgentId(session, 'main')).toBe('claude-dev');

    await act(async () => {
      root.render(
        <SessionCard
          session={session}
          variant="grid"
          sessionAgentId="claude-dev"
          sessionAgentName="Claude Dev"
          sessionAgentAvatar="https://example.com/custom.png"
          sessionAgentRuntime="claude"
          labels={{
            continueChat: 'Continue',
            archive: 'Archive',
            unarchive: 'Unarchive',
            pin: 'Pin',
            unpin: 'Unpin',
            export: 'Export',
            delete: 'Delete',
            tokens: 'tok',
            cost: 'Cost',
            costPartial: 'Partial',
            costUnknown: 'Unknown',
            noUsage: '—',
            unnamedSession: 'Untitled',
          }}
          onOpen={() => {}}
          onAction={() => {}}
        />,
      );
    });

    expect(container.querySelector('[data-external-runtime-pill="claude"]')?.textContent).toBe('Claude Code');
    expect(container.querySelector('[data-external-runtime-badge="claude"]')).not.toBeNull();
    expect(container.textContent).toContain('Claude Dev');
  });
});
