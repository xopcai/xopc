// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_COMPOSER_CAPABILITIES, PERSONAL_COMPOSER_CAPABILITIES } from '@/features/chat/composer/composer-capabilities';
import { useCommandPalette } from '@/features/chat/palette/use-command-palette';
import { useAtMentionPicker } from '@/features/chat/palette/use-at-mention-picker';
import { fetchCommandsCached, getChatSkillsCached } from '@/features/chat/palette/command-palette-api';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { atMentionProviders } from '@/features/chat/palette/at-mention-api';

vi.mock('@/features/chat/palette/command-palette-api', () => ({
  fetchCommandsCached: vi.fn(async () => []),
  getChatSkillsCached: vi.fn(async () => ({ skills: [] })),
}));
vi.mock('@/features/chat/agent-selection/chat-agents-api', () => ({ fetchChatAgents: vi.fn(async () => ({ items: [] })) }));
vi.mock('@/features/chat/palette/at-mention-api', () => ({
  atMentionProviders: ['file', 'note', 'session', 'browser_tab', 'skill', 'agent', 'mcp_server', 'mcp_resource'].map(kind => ({
    kind, search: vi.fn(async () => [{ kind, id: kind, name: kind }]),
  })),
  fetchWorkspaceBrowseEntries: vi.fn(async () => []),
}));

describe('Personal composer capabilities', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  function Harness({ text, personal }: { text: string; personal: boolean }) {
    const capabilities = personal ? PERSONAL_COMPOSER_CAPABILITIES : CHAT_COMPOSER_CAPABILITIES;
    const palette = useCommandPalette(text, text.length, { capabilities });
    const mentions = useAtMentionPicker(text, text.length, { capabilities, conversationId: 'conversation', slashPaletteOpen: palette.open });
    return <output data-palette={palette.open} data-slash-range={Boolean(palette.slashRange)}>{mentions.items.map(item => item.kind).join(',')}</output>;
  }

  it('does not load or intercept slash input in Personal AI, preserving the ordinary chat palette', async () => {
    for (const text of ['/', '/abort', '/skill:weather']) {
      await act(async () => root.render(<Harness text={text} personal />));
      expect(container.querySelector('output')?.dataset.palette).toBe('false');
      expect(container.querySelector('output')?.dataset.slashRange).toBe('false');
    }
    expect(fetchCommandsCached).not.toHaveBeenCalled();
    expect(getChatSkillsCached).not.toHaveBeenCalled();
    expect(fetchChatAgents).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness text="/" personal={false} />));
    expect(container.querySelector('output')?.dataset.palette).toBe('true');
    expect(fetchCommandsCached).toHaveBeenCalledOnce();
    expect(getChatSkillsCached).toHaveBeenCalledOnce();
    expect(fetchChatAgents).toHaveBeenCalledOnce();
  });

  it('keeps reference providers while excluding Skills and Agent switches from @', async () => {
    await act(async () => root.render(<Harness text="@" personal />));
    expect(container.textContent).toContain('note');
    expect(container.textContent).toContain('file');
    expect(container.textContent).toContain('session');
    expect(container.textContent).not.toContain('skill');
    expect(container.textContent).not.toContain('agent');
    for (const kind of ['skill', 'agent']) {
      expect(atMentionProviders.find(provider => provider.kind === kind)?.search).not.toHaveBeenCalled();
    }
  });
});
