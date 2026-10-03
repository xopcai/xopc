// @vitest-environment jsdom

import type { SessionContextSummary } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig, type State } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchJson } from '@/lib/fetch';
import { useGatewayStore } from '@/stores/gateway-store';

import { mergeContextSources } from '../merge-context-sources';
import { SessionContextPanel, type SessionContextPanelProps } from '../session-context-panel';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
vi.mock('../../session/local-session-drafts', () => ({ readLocalSessionDraft: vi.fn(async () => undefined) }));

describe('session context panel', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let cache: Map<string, State<SessionContextSummary>>;
  const summary = (conversationId: string): SessionContextSummary => ({
    conversationId, observedAt: new Date().toISOString(), work: { project: { id: conversationId, title: `Project ${conversationId}` } },
    sources: [{ kind: 'note', id: 'note-a', title: 'Source note', origins: [{ kind: 'session' }] }],
    sourcesHasMore: false, unavailableSections: [],
    environment: { kind: 'managed_worktree', rootPath: '/tmp/worktree', available: true, detached: true, headSha: '1234567890' },
  });
  const render = async (props: Partial<SessionContextPanelProps> = {}) => {
    const merged = { conversationId: 'one', ...props };
    await act(async () => root.render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><MemoryRouter>
      <SessionContextPanel key={merged.conversationId ?? 'new'} {...merged} />
    </MemoryRouter></SWRConfig>));
  };
  const toggle = async () => { await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Session info"]')!.click()); };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    cache = new Map();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useGatewayStore.setState({ conversationId: undefined });
    vi.mocked(fetchJson).mockReset().mockImplementation(async (url) => ({ summary: summary(String(url).includes('/two/') ? 'two' : 'one') }));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it('merges the same Note while keeping its durable relation and pending state', () => {
    expect(mergeContextSources(summary('one').sources, [{ kind: 'note', sourceId: 'note-a', title: 'Draft', expectedVersion: 'v2' }])).toEqual([
      { ...summary('one').sources[0], pending: true },
    ]);
  });

  it('keeps different source kinds with the same id distinct', () => {
    expect(mergeContextSources(summary('one').sources, [
      { kind: 'file', sourceId: 'note-a', title: 'note-a.ts', expectedVersion: 'v1' },
    ]).map(({ kind, id, pending }) => [kind, id, pending])).toEqual([
      ['note', 'note-a', false], ['file', 'note-a', true],
    ]);
  });

  it('shows files, chats, MCP resources, and unsent attachments without implying a lasting link', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ summary: { ...summary('one'), sources: [
      { kind: 'file', id: 'file-1', title: 'src/example.ts', fileKind: 'file', origins: [{ kind: 'recent' }] },
      { kind: 'session', id: 'other-chat', title: 'Other chat', origins: [{ kind: 'recent' }] },
      { kind: 'mcp_resource', id: 'issue-42', title: 'Issue #42', origins: [{ kind: 'recent' }] },
    ] } });
    await render({ draftAttachments: [{ id: 'draft-image', title: 'screenshot.png' }] });
    await toggle();
    expect(document.body.textContent).toContain('Recently used');
    expect(document.body.textContent).toContain('src/example.ts');
    expect(document.querySelector('a[href="/chat/other-chat"]')).not.toBeNull();
    expect(document.querySelector('a[href*="issue-42"]')).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click());
    expect(document.body.textContent).toContain('screenshot.png');
    expect(document.body.textContent).toContain('Pending send');
  });

  it('shows draft context before session creation without requesting a missing session', async () => {
    await render({ conversationId: null, project: { id: 'draft', name: 'Draft project' }, draftRefs: [{ kind: 'note', sourceId: 'draft-note', title: 'Draft source', expectedVersion: 'v2' }] });
    await toggle();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Draft project');
    expect(document.body.textContent).toContain('Pending send');
    expect(document.querySelector('a[href*="draft-note"]')).not.toBeNull();
  });

  it('shows provenance, actual detached HEAD and existing navigation', async () => {
    await render({ draftRefs: [{ kind: 'note', sourceId: 'note-a', title: 'Draft source', expectedVersion: 'v2' }] });
    await toggle();
    expect(document.querySelectorAll('a[href*="notes/note-a"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Linked to chat · Pending send');
    expect(document.body.textContent).toContain('Detached HEAD · 12345678');
    expect(document.body.textContent).not.toContain('Linked sources do not mean');
    expect(document.querySelector('a[href*="projects/one"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Copy environment path"]')).not.toBeNull();
  });

  it('closes on session switch and never shows the previous session while loading', async () => {
    await render(); await toggle();
    vi.mocked(fetchJson).mockImplementation(() => new Promise(() => {}));
    await render({ conversationId: 'two' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Project one');
    await toggle();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Project one');
  });

  it('does not reuse a summary after gateway credentials change', async () => {
    await render(); await toggle();
    vi.mocked(fetchJson).mockImplementation(() => new Promise(() => {}));
    await act(async () => useGatewayStore.setState({ conversationId: 'another-device' }));
    expect(document.body.textContent).not.toContain('Project one');
  });

  it('does not refresh on completion events while closed; refreshes when opened', async () => {
    await render();
    const calls = vi.mocked(fetchJson).mock.calls.length;
    await act(async () => window.dispatchEvent(new CustomEvent('run-completed')));
    expect(fetchJson).toHaveBeenCalledTimes(calls);
    await toggle();
    expect(vi.mocked(fetchJson).mock.calls.length).toBeGreaterThan(calls);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('run-completed'));
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(vi.mocked(fetchJson).mock.calls.length).toBeGreaterThan(calls + 1);
  });

  it('renders unavailable notes without leaking a stale draft title or a link', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ summary: { ...summary('one'), sources: [{ kind: 'note', id: 'note-a', unavailable: true, origins: [{ kind: 'session' }] }] } });
    await render({ draftRefs: [{ kind: 'note', sourceId: 'note-a', title: 'Stale draft', expectedVersion: 'v1' }] });
    await toggle();
    expect(document.body.textContent).not.toContain('Stale draft');
    expect(document.body.textContent).toContain('Temporarily unavailable');
    expect(document.querySelector('a[href*="notes/note-a"]')).toBeNull();
  });

  it('hides cached object titles after a failed refresh', async () => {
    await render(); await toggle();
    expect(document.body.textContent).toContain('Project one');
    vi.mocked(fetchJson).mockRejectedValue(new Error('Forbidden'));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('run-completed'));
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(document.body.textContent).not.toContain('Project one');
    expect(document.body.textContent).not.toContain('Source note');
    expect(document.body.textContent).toContain('Temporarily unavailable');
  });

  it('keeps new-project context closed and never displays an environment picker in the header', async () => {
    await render({ conversationId: null, project: { id: 'code', name: 'Code', workspaceRoot: '/repo' } });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await toggle();
    expect(document.body.textContent).toContain('Code');
    expect(document.querySelector('[aria-label="New session environment"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Create session');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('offers a new-session link for an existing environment, never an in-place switch', async () => {
    await render({ project: { id: 'one', name: 'Code', workspaceRoot: '/repo' } });
    await toggle();
    expect(document.querySelector('a[href="/chat/new?projectId=one"]')?.textContent).toContain('another environment');
    expect(document.querySelector('[aria-label="New session environment"]')).toBeNull();
  });
});
