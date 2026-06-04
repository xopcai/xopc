import { describe, expect, it, vi } from 'vitest';

import type { KeybindingsManager } from '@earendil-works/pi-tui';

import { ChatLog } from '../components/chat-log.js';
import { createTuiCommandHandler } from '../tui-commands.js';
import { createInitialState } from '../tui-types.js';
import { StreamAssembler } from '../stream-assembler.js';

function makeHandler(overrides: Partial<Parameters<typeof createTuiCommandHandler>[0]> = {}) {
  const state = createInitialState('agent:main:main');
  const chatLog = new ChatLog();
  const tui = { requestRender: vi.fn() } as unknown as Parameters<
    typeof createTuiCommandHandler
  >[0]['tui'];
  const sendMessage = vi.fn();
  const setSession = vi.fn(async () => {});
  const resetSession = vi.fn(async () => {});
  const abortActive = vi.fn(async () => {});

  const handler = createTuiCommandHandler({
    state,
    chatLog,
    tui,
    assembler: new StreamAssembler(),
    isLocalMode: true,
    abortActive,
    sendMessage,
    requestExit: vi.fn(),
    updateFooter: vi.fn(),
    keybindings: { getAll: () => [] } as unknown as KeybindingsManager,
    currentAgentId: 'main',
    setSession,
    resetSession,
    ...overrides,
  });

  return { handler, state, sendMessage, setSession, resetSession, abortActive, chatLog };
}

describe('TUI session slash commands', () => {
  it('/new switches session without forwarding to agent', async () => {
    const { handler, sendMessage, setSession } = makeHandler();
    handler('/new');
    await vi.waitFor(() => expect(setSession).toHaveBeenCalledOnce());

    const rawKey = setSession.mock.calls[0]![0] as string;
    expect(rawKey).toMatch(/^tui-[0-9a-f-]{36}$/i);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/reset calls resetSession and does not forward slash to agent', async () => {
    const { handler, sendMessage, resetSession } = makeHandler();
    handler('/reset');
    await vi.waitFor(() => expect(resetSession).toHaveBeenCalledOnce());
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/clear aliases /reset', async () => {
    const { handler, resetSession } = makeHandler();
    handler('/clear');
    await vi.waitFor(() => expect(resetSession).toHaveBeenCalledOnce());
  });
});
