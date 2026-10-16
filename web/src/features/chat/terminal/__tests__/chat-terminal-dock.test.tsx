// @vitest-environment jsdom

import type { ITerminalOptions } from '@xterm/xterm';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatTerminalDock } from '@/features/chat/terminal/chat-terminal-dock';
import { resolveSession } from '@/features/sessions/session-api';
import { useLocaleStore } from '@/stores/locale-store';
import { useTerminalPanelStore } from '@/stores/terminal-panel-store';

const { terminalOptions, materialize } = vi.hoisted(() => ({
  terminalOptions: [] as ITerminalOptions[],
  materialize: vi.fn(async () => {}),
}));

vi.mock('@/features/chat/session/session-manager', () => ({
  SessionManager: class { materialize = materialize; },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100;
    rows = 24;
    constructor(public options: ITerminalOptions) {
      terminalOptions.push(options);
    }
    loadAddon() {}
    open() {}
    write() {}
    focus() {}
    dispose() {}
    onData() { return { dispose() {} }; }
  },
}));

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@/features/sessions/session-api', () => ({
  resolveSession: vi.fn(async () => ({ transcriptId: 'session-id' })),
}));

describe('ChatTerminalDock', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const api = {
    create: vi.fn(async (input: { terminalKey: string }) => ({
      terminalId: input.terminalKey,
      replay: '',
      replaySequence: 0,
    })),
    resize: vi.fn(async () => ({ ok: true })),
    dispose: vi.fn(async () => ({ ok: true })),
    write: vi.fn(),
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
    onError: vi.fn(() => vi.fn()),
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('electronAPI', { terminal: api });
    Element.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
    terminalOptions.length = 0;
    document.documentElement.style.setProperty('--color-surface-terminal', '#ffffff');
    document.documentElement.style.setProperty('--color-fg', '#111111');
    useLocaleStore.setState({ language: 'en' });
    useTerminalPanelStore.setState({
      openByConversationId: {},
      tabsByConversationId: {},
      activeTabKeyByConversationId: {},
      height: 300,
    });
    useTerminalPanelStore.getState().toggle('session-key');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    document.documentElement.style.removeProperty('--color-surface-terminal');
    document.documentElement.style.removeProperty('--color-fg');
    vi.unstubAllGlobals();
  });

  it('uses a full-width neutral canvas and starts the shell without confirmation', async () => {
    await act(async () => root.render(<ChatTerminalDock conversationId="session-key" />));

    expect(container.querySelector('section')?.classList.contains('w-full')).toBe(true);
    expect(container.querySelector('section')?.classList.contains('bg-surface-terminal')).toBe(true);
    expect(terminalOptions[0]).toMatchObject({
      minimumContrastRatio: 4.5,
      theme: { background: '#ffffff', foreground: '#111111', cursor: '#111111' },
    });
    expect(api.create).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });

  it('materializes a new conversation before resolving its transcript and opening the PTY', async () => {
    let finishPreparation!: () => void;
    materialize.mockImplementationOnce(() => new Promise<void>((resolve) => { finishPreparation = resolve; }));
    await act(async () => root.render(<ChatTerminalDock conversationId="session-key" />));

    expect(materialize).toHaveBeenCalledWith('session-key', 'session_resources');
    expect(resolveSession).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => finishPreparation());

    expect(resolveSession).toHaveBeenCalledWith({ conversationId: 'session-key' });
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'session-key', transcriptId: 'session-id',
    }));
  });

  it('shows preparation failures without trying to resolve a missing session', async () => {
    materialize.mockRejectedValueOnce(new Error('Conversation environment is not ready yet'));
    await act(async () => root.render(<ChatTerminalDock conversationId="session-key" />));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Conversation environment is not ready yet');
    expect(resolveSession).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('does not open a terminal if the dock unmounts during session preparation', async () => {
    let finishPreparation!: () => void;
    materialize.mockImplementationOnce(() => new Promise<void>((resolve) => { finishPreparation = resolve; }));
    await act(async () => root.render(<ChatTerminalDock conversationId="session-key" />));
    await act(async () => root.render(null));
    await act(async () => finishPreparation());

    expect(resolveSession).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('updates the terminal theme in place without recreating the PTY', async () => {
    await act(async () => root.render(<ChatTerminalDock conversationId="session-key" />));
    await act(async () => {
      document.documentElement.style.setProperty('--color-surface-terminal', '#181818');
      document.documentElement.style.setProperty('--color-fg', '#f4f6f8');
    });

    expect(terminalOptions[0].theme).toMatchObject({
      background: '#181818', foreground: '#f4f6f8', cursorAccent: '#181818',
    });
    expect(terminalOptions).toHaveLength(1);
    expect(api.create).toHaveBeenCalledOnce();
  });

  it('keeps new-tab and tab-close actions available in the compact header', async () => {
    await act(async () => root.render(<ChatTerminalDock conversationId="session-key" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New terminal"]')!.click());
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(api.create).toHaveBeenCalledTimes(2);

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close terminal 2"]')!.click());
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(api.dispose).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('header button')).toHaveLength(4);
  });
});
