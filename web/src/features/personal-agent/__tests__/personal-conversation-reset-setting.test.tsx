// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchJson: vi.fn() }));
const drafts = vi.hoisted(() => ({ rememberSessionTranscript: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/fetch', () => api);
vi.mock('@/features/chat/session/local-session-drafts', () => drafts);

import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { PersonalConversationResetSetting } from '../personal-conversation-reset-setting';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  useChatSessionStore.setState({ sessions: {} });
  vi.clearAllMocks();
});

async function renderSetting(props: {
  zh?: boolean;
  displayName?: string;
  profile?: { conversationId?: string; transcriptId?: string; state?: 'provisioning' | 'ready' | 'error' } | null;
}) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter>
      <PersonalConversationResetSetting
        zh={props.zh ?? true}
        displayName={props.displayName ?? 'Ada'}
        profile={props.profile}
      />
    </MemoryRouter>,
  ));
}

describe('PersonalConversationResetSetting', () => {
  it('stays hidden when the Personal Agent is not ready', async () => {
    await renderSetting({ profile: { conversationId: 'conv-1', state: 'provisioning' } });
    expect(container.textContent).toBe('');
  });

  it('confirms reset, calls the endpoint, clears live chat state, and emits sync events', async () => {
    const conversationId = 'personal-conv-1';
    useChatSessionStore.getState().setCommittedSnapshot(conversationId, {
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'Old message' }], timestamp: 1 } as never],
      hasMore: true,
    });
    useChatSessionStore.getState().setSessionFlags(conversationId, { streaming: true, sending: true });

    const nextProfile = {
      agentId: 'personal-1',
      conversationId,
      transcriptId: 'transcript-new',
      state: 'ready' as const,
      displayName: 'Ada',
      appearance: 'loopi' as const,
      voicePreference: null,
      revision: 1,
      errorMessage: null,
    };
    api.fetchJson.mockResolvedValue({
      ok: true,
      payload: {
        conversationId,
        transcriptId: 'transcript-new',
        previousTranscriptId: 'transcript-old',
        profile: nextProfile,
      },
    });

    const events: string[] = [];
    const onUpdated = () => events.push('personal-agent-updated');
    const onTranscript = (event: Event) => events.push(`transcript:${(event as CustomEvent<{ key?: string }>).detail?.key}`);
    const onUnread = () => events.push('personal-unread-updated');
    window.addEventListener('personal-agent-updated', onUpdated);
    window.addEventListener('session-transcript-updated', onTranscript);
    window.addEventListener('personal-unread-updated', onUnread);

    try {
      await renderSetting({
        zh: true,
        displayName: 'Ada',
        profile: { conversationId, transcriptId: 'transcript-old', state: 'ready' },
      });

      const trigger = container.querySelector('button');
      expect(trigger?.textContent).toContain('重新开始对话');
      await act(async () => trigger?.click());

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain('重新开始对话？');
      const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find((button) => button.textContent?.includes('归档并重新开始'));
      expect(confirmButton).toBeDefined();

      await act(async () => confirmButton?.click());

      expect(api.fetchJson).toHaveBeenCalledWith(
        expect.stringContaining('/api/personal-agent/conversation/reset'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ expectedTranscriptId: 'transcript-old' }),
        }),
      );
      expect(drafts.rememberSessionTranscript).toHaveBeenCalledWith(conversationId, 'transcript-new');
      expect(useChatSessionStore.getState().sessions[conversationId]?.messages).toEqual([]);
      expect(useChatSessionStore.getState().sessions[conversationId]?.streaming).toBe(false);
      expect(events).toEqual([
        'personal-agent-updated',
        `transcript:${conversationId}`,
        'personal-unread-updated',
      ]);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(container.querySelector('[role="status"]')?.textContent).toContain('已归档当前对话记录并开启新对话');
      expect(container.querySelector('a[href="/personal"]')?.textContent).toContain('Ada');
    } finally {
      window.removeEventListener('personal-agent-updated', onUpdated);
      window.removeEventListener('session-transcript-updated', onTranscript);
      window.removeEventListener('personal-unread-updated', onUnread);
    }
  });

  it('surfaces errors inside the dialog when reset is blocked', async () => {
    api.fetchJson.mockRejectedValue(new Error('End the voice call before starting a new conversation'));
    await renderSetting({
      zh: false,
      displayName: 'Ada',
      profile: { conversationId: 'personal-conv-1', transcriptId: 'transcript-old', state: 'ready' },
    });

    await act(async () => container.querySelector('button')?.click());
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent?.includes('Archive & start fresh'));
    await act(async () => confirmButton?.click());

    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent)
      .toContain('End the voice call before starting a new conversation');
  });
});
