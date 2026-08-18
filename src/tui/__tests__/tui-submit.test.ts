import { describe, expect, it, vi } from 'vitest';

import { createEditorSubmitHandler, createSubmitBurstCoalescer, shouldEnableWindowsGitBashPasteFallback } from '../tui-submit.js';

describe('createEditorSubmitHandler', () => {
  it('enters shell mode when submitting a bare bang', () => {
    const enterShellMode = vi.fn();
    const sendMessage = vi.fn();
    const handleBangLine = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory: vi.fn() },
      handleCommand: vi.fn(),
      sendMessage,
      handleBangLine,
      enterShellMode,
    });

    submit('!');

    expect(enterShellMode).toHaveBeenCalledOnce();
    expect(handleBangLine).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('runs shell mode input as a local shell command and exits mode', async () => {
    const addToHistory = vi.fn();
    const exitShellMode = vi.fn();
    const handleBangLine = vi.fn().mockResolvedValue(undefined);
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory },
      handleCommand: vi.fn(),
      sendMessage: vi.fn(),
      handleBangLine,
      getMode: () => 'shell',
      exitShellMode,
    });

    submit('codex .');
    await Promise.resolve();

    expect(addToHistory).toHaveBeenCalledWith('codex .');
    expect(handleBangLine).toHaveBeenCalledWith('!codex .');
    expect(exitShellMode).toHaveBeenCalledOnce();
  });

  it('exits shell mode on blank submit', () => {
    const exitShellMode = vi.fn();
    const handleBangLine = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory: vi.fn() },
      handleCommand: vi.fn(),
      sendMessage: vi.fn(),
      handleBangLine,
      getMode: () => 'shell',
      exitShellMode,
    });

    submit('   ');

    expect(exitShellMode).toHaveBeenCalledOnce();
    expect(handleBangLine).not.toHaveBeenCalled();
  });

  it('steers instead of sending when the agent is busy', () => {
    const steerWhileBusy = vi.fn();
    const sendMessage = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory: vi.fn() },
      handleCommand: vi.fn(),
      sendMessage,
      handleBangLine: vi.fn(),
      isAgentBusy: () => true,
      steerWhileBusy,
    });

    submit('change direction please');
    expect(steerWhileBusy).toHaveBeenCalledWith('change direction please');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('still sends slash commands while busy', () => {
    const handleCommand = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory: vi.fn() },
      handleCommand,
      sendMessage: vi.fn(),
      handleBangLine: vi.fn(),
      isAgentBusy: () => true,
      steerWhileBusy: vi.fn(),
    });

    submit('/abort');
    expect(handleCommand).toHaveBeenCalledWith('/abort');
  });

  it('sends a default prompt when only attachments are pending', () => {
    const sendMessage = vi.fn();
    const addToHistory = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory },
      handleCommand: vi.fn(),
      sendMessage,
      handleBangLine: vi.fn(),
      hasPendingAttachments: () => true,
      defaultAttachmentMessage: 'Please analyze the attached image.',
    });

    submit('');

    expect(addToHistory).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('Please analyze the attached image.');
  });

  it('records chat input separately from local shell history', () => {
    const recordChatHistory = vi.fn();
    const addToHistory = vi.fn();
    const submit = createEditorSubmitHandler({
      editor: { setText: vi.fn(), addToHistory },
      recordChatHistory,
      handleCommand: vi.fn(),
      sendMessage: vi.fn(),
      handleBangLine: vi.fn(),
    });

    submit('hello');
    submit('!pwd');

    expect(recordChatHistory).toHaveBeenCalledOnce();
    expect(recordChatHistory).toHaveBeenCalledWith('hello');
    expect(addToHistory).toHaveBeenCalledWith('!pwd');
  });
});

describe('createSubmitBurstCoalescer', () => {
  it('merges rapid single-line submits before flushing', () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const wrapped = createSubmitBurstCoalescer({
      submit,
      enabled: true,
      burstWindowMs: 50,
      setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimer: clearTimeout,
    });

    wrapped('line1');
    wrapped('line2');
    vi.advanceTimersByTime(60);

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith('line1\nline2');
    vi.useRealTimers();
  });

  it('passes through immediately when disabled', () => {
    const submit = vi.fn();
    const wrapped = createSubmitBurstCoalescer({ submit, enabled: false });
    wrapped('a');
    expect(submit).toHaveBeenCalledWith('a');
  });

  it('passes shell commands through immediately when enabled', () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const wrapped = createSubmitBurstCoalescer({
      submit,
      enabled: true,
      burstWindowMs: 50,
      setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimer: clearTimeout,
    });

    wrapped('!');

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith('!');
    vi.useRealTimers();
  });
});

describe('shouldEnableWindowsGitBashPasteFallback', () => {
  it('enables on darwin + Apple Terminal', () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: 'darwin',
        env: { TERM_PROGRAM: 'Apple_Terminal' },
      }),
    ).toBe(true);
  });

  it('disables on linux by default', () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: 'linux',
        env: {},
      }),
    ).toBe(false);
  });
});
