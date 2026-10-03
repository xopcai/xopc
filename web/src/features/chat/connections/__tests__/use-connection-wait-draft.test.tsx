// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { patchSessionAgentConfigView } from '@/features/chat/session/patch-session-agent-config-view';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { useConnectionWait } from '@/features/chat/connections/use-connection-wait';

const { readLocalSessionDraft, fetchJson } = vi.hoisted(() => ({
  readLocalSessionDraft: vi.fn(),
  fetchJson: vi.fn(),
}));

vi.mock('@/features/chat/session/local-session-drafts', () => ({ readLocalSessionDraft }));
vi.mock('@/lib/fetch', () => ({ fetchJson }));

const conversationId = '21e42979-517b-457c-90fd-5ee5cd15ce6c';

function Probe() {
  const { wait } = useConnectionWait(conversationId);
  return <div>{wait ? 'waiting' : 'no wait'}</div>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  useChatSessionStore.setState({ sessions: {} });
  readLocalSessionDraft.mockResolvedValue({ conversationId });
  fetchJson.mockResolvedValue({ payload: { transcriptId: 'transcript', revision: 1, wait: null } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('does not request a connection wait until the local draft becomes a persisted session', async () => {
  patchSessionAgentConfigView(conversationId, { model: 'test/model', localDraft: true });
  await act(async () => {
    root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Probe /></SWRConfig>);
    await Promise.resolve();
  });
  expect(fetchJson).not.toHaveBeenCalled();

  readLocalSessionDraft.mockResolvedValue(undefined);
  await act(async () => {
    patchSessionAgentConfigView(conversationId, { model: 'test/model', configVersion: 1 });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchJson).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe('no wait');
});
