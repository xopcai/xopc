import { describe, it, expect, vi } from 'vitest';
import type { MutableRefObject } from 'react';

import {
  applyPaletteItem,
  type PaletteApplyContext,
} from '@/features/chat/composer/palette-item-handlers';
import type { PaletteItem, SlashRange } from '@/features/chat/palette/command-palette.types';

const TEST_MAX_PENDING = 10;

function valueRef(initial: string): MutableRefObject<string> {
  return { current: initial };
}

function makeCtx(opts: {
  initialText: string;
  slashRange: SlashRange | null;
  runBusy?: boolean;
  pendingFollowUpsCount?: number;
  maxPendingFollowUps?: number;
  thinkingLevel?: string;
  onChatAgentChange?: (agentId: string) => void;
  onAddPendingFollowUp?: (text: string) => void;
  onAbort?: () => void;
}): PaletteApplyContext & {
  resetEditor: ReturnType<typeof vi.fn>;
  clearAttachments: ReturnType<typeof vi.fn>;
  onSend: ReturnType<typeof vi.fn>;
  onUserTextCommitted: ReturnType<typeof vi.fn>;
  onChatAgentChange: ReturnType<typeof vi.fn>;
  onAddPendingFollowUp: ReturnType<typeof vi.fn>;
  onAbort: ReturnType<typeof vi.fn>;
} {
  const ref = valueRef(opts.initialText);
  const resetEditor: PaletteApplyContext['editor']['resetEditor'] = (nextOpts) => {
    if (nextOpts && typeof nextOpts.nextText === 'string') {
      ref.current = nextOpts.nextText;
    } else if (nextOpts === undefined) {
      ref.current = '';
    }
  };
  const resetEditorSpy = vi.fn(resetEditor);
  const clearAttachments = vi.fn();
  const onSend = vi.fn();
  const onUserTextCommitted = vi.fn();
  const onChatAgentChange = vi.fn(opts.onChatAgentChange);
  const onAddPendingFollowUp = vi.fn(opts.onAddPendingFollowUp);
  const onAbort = vi.fn(opts.onAbort);

  return {
    slashRange: opts.slashRange,
    runBusy: opts.runBusy ?? false,
    pendingFollowUpsCount: opts.pendingFollowUpsCount ?? 0,
    maxPendingFollowUps: opts.maxPendingFollowUps ?? TEST_MAX_PENDING,
    thinkingLevel: opts.thinkingLevel ?? 'medium',
    editor: { valueRef: ref, resetEditor: resetEditorSpy },
    attachments: { clearAttachments },
    callbacks: {
      onSend,
      onUserTextCommitted,
      onChatAgentChange,
      onAddPendingFollowUp,
      onAbort,
    },
    resetEditor: resetEditorSpy,
    clearAttachments,
    onSend,
    onUserTextCommitted,
    onChatAgentChange,
    onAddPendingFollowUp,
    onAbort,
  };
}

const skillItem: PaletteItem = {
  kind: 'skill',
  id: 'skill:docx',
  name: 'docx',
  description: '',
};

const cmdNoArgs: PaletteItem = {
  kind: 'command',
  id: 'cmd:new',
  name: 'new',
  description: '',
  acceptsArgs: false,
};

const cmdWithArgs: PaletteItem = {
  kind: 'command',
  id: 'cmd:reply',
  name: 'reply',
  description: '',
  acceptsArgs: true,
};

const cmdAbort: PaletteItem = {
  kind: 'command',
  id: 'cmd:abort',
  name: 'abort',
  description: '',
  aliases: ['stop', 'cancel'],
  acceptsArgs: false,
};

const cmdStopAlias: PaletteItem = {
  kind: 'command',
  id: 'cmd:halt',
  name: 'halt',
  description: '',
  aliases: ['stop'],
  acceptsArgs: false,
};

const agentItem: PaletteItem = {
  kind: 'agent',
  id: 'agent:secondary',
  name: 'secondary',
  description: 'Side agent',
  category: 'agent',
};

describe('palette-item-handlers / skill', () => {
  it('replaces slash range with /skill:name pill text and a trailing space, places caret after', () => {
    const ctx = makeCtx({
      initialText: 'hi /doc world',
      slashRange: { start: 3, end: 7, query: 'doc' },
    });
    applyPaletteItem(skillItem, ctx);
    expect(ctx.editor.valueRef.current).toBe('hi /skill:docx  world');
    expect(ctx.resetEditor).toHaveBeenCalledWith({
      nextText: 'hi /skill:docx  world',
      caretOffset: 'hi /skill:docx '.length,
      focus: true,
    });
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.clearAttachments).not.toHaveBeenCalled();
  });

  it('no-op when slashRange is null', () => {
    const ctx = makeCtx({ initialText: '', slashRange: null });
    applyPaletteItem(skillItem, ctx);
    expect(ctx.resetEditor).not.toHaveBeenCalled();
  });
});

describe('palette-item-handlers / command (acceptsArgs=false, idle)', () => {
  it('sends `/${name}` immediately and clears editor + attachments', () => {
    const ctx = makeCtx({
      initialText: '/n',
      slashRange: { start: 0, end: 2, query: 'n' },
      thinkingLevel: 'high',
    });
    applyPaletteItem(cmdNoArgs, ctx);
    expect(ctx.onSend).toHaveBeenCalledWith('/new', undefined, 'high');
    expect(ctx.onUserTextCommitted).toHaveBeenCalledWith('/new');
    expect(ctx.clearAttachments).toHaveBeenCalledTimes(1);
    expect(ctx.resetEditor).toHaveBeenCalledWith();
    expect(ctx.onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(ctx.onAbort).not.toHaveBeenCalled();
  });

  it('blocked when slash is not at start of composer', () => {
    const ctx = makeCtx({
      initialText: 'hi /n',
      slashRange: { start: 3, end: 5, query: 'n' },
    });
    applyPaletteItem(cmdNoArgs, ctx);
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.resetEditor).not.toHaveBeenCalled();
  });
});

describe('palette-item-handlers / command (acceptsArgs=false, runBusy)', () => {
  it('queues via onAddPendingFollowUp instead of onSend when runBusy', () => {
    const ctx = makeCtx({
      initialText: '/n',
      slashRange: { start: 0, end: 2, query: 'n' },
      runBusy: true,
    });
    applyPaletteItem(cmdNoArgs, ctx);
    expect(ctx.onAddPendingFollowUp).toHaveBeenCalledWith('/new', undefined);
    expect(ctx.onUserTextCommitted).toHaveBeenCalledWith('/new');
    expect(ctx.clearAttachments).toHaveBeenCalledTimes(1);
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.onAbort).not.toHaveBeenCalled();
  });

  it('queues when not runBusy but pending queue is non-empty (steerKbdBusy parity)', () => {
    const ctx = makeCtx({
      initialText: '/n',
      slashRange: { start: 0, end: 2, query: 'n' },
      runBusy: false,
      pendingFollowUpsCount: 2,
    });
    applyPaletteItem(cmdNoArgs, ctx);
    expect(ctx.onAddPendingFollowUp).toHaveBeenCalledWith('/new', undefined);
    expect(ctx.onSend).not.toHaveBeenCalled();
  });

  it('no-ops when queue is full (onAddPendingFollowUp not called)', () => {
    const ctx = makeCtx({
      initialText: '/n',
      slashRange: { start: 0, end: 2, query: 'n' },
      runBusy: true,
      pendingFollowUpsCount: TEST_MAX_PENDING,
    });
    applyPaletteItem(cmdNoArgs, ctx);
    expect(ctx.onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.resetEditor).not.toHaveBeenCalled();
  });

  it('no-ops gracefully when onAddPendingFollowUp is missing', () => {
    const ctx = makeCtx({
      initialText: '/n',
      slashRange: { start: 0, end: 2, query: 'n' },
      runBusy: true,
    });
    ctx.callbacks.onAddPendingFollowUp = undefined;
    applyPaletteItem(cmdNoArgs, ctx);
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.resetEditor).not.toHaveBeenCalled();
  });
});

describe('palette-item-handlers / command (abort-class)', () => {
  it('calls onAbort and strips slash range when runBusy', () => {
    const ctx = makeCtx({
      initialText: '/abort',
      slashRange: { start: 0, end: 6, query: 'abort' },
      runBusy: true,
    });
    applyPaletteItem(cmdAbort, ctx);
    expect(ctx.onAbort).toHaveBeenCalledTimes(1);
    expect(ctx.onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.resetEditor).toHaveBeenCalledWith({ nextText: '', caretOffset: 0 });
    expect(ctx.editor.valueRef.current).toBe('');
  });

  it('also matches when only an alias is in the abort-class set', () => {
    const ctx = makeCtx({
      initialText: '/halt',
      slashRange: { start: 0, end: 5, query: 'halt' },
      runBusy: true,
    });
    applyPaletteItem(cmdStopAlias, ctx);
    expect(ctx.onAbort).toHaveBeenCalledTimes(1);
    expect(ctx.onAddPendingFollowUp).not.toHaveBeenCalled();
  });

  it('idle path is unchanged: still goes through onSend, not onAbort', () => {
    const ctx = makeCtx({
      initialText: '/abort',
      slashRange: { start: 0, end: 6, query: 'abort' },
    });
    applyPaletteItem(cmdAbort, ctx);
    expect(ctx.onSend).toHaveBeenCalledWith('/abort', undefined, 'medium');
    expect(ctx.onAbort).not.toHaveBeenCalled();
  });

  it('runBusy + no onAbort: handler is a no-op (does not fall through to send)', () => {
    const ctx = makeCtx({
      initialText: '/abort',
      slashRange: { start: 0, end: 6, query: 'abort' },
      runBusy: true,
    });
    ctx.callbacks.onAbort = undefined;
    applyPaletteItem(cmdAbort, ctx);
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(ctx.resetEditor).not.toHaveBeenCalled();
  });
});

describe('palette-item-handlers / command (acceptsArgs=true)', () => {
  it('inserts `/${name} ` placeholder and sets caret after the trailing space', () => {
    const ctx = makeCtx({
      initialText: '/r',
      slashRange: { start: 0, end: 2, query: 'r' },
    });
    applyPaletteItem(cmdWithArgs, ctx);
    expect(ctx.editor.valueRef.current).toBe('/reply ');
    expect(ctx.resetEditor).toHaveBeenCalledWith({
      nextText: '/reply ',
      caretOffset: '/reply '.length,
      focus: true,
    });
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.clearAttachments).not.toHaveBeenCalled();
  });

  it('also inserts text while runBusy (no longer blocked)', () => {
    const ctx = makeCtx({
      initialText: '/r',
      slashRange: { start: 0, end: 2, query: 'r' },
      runBusy: true,
    });
    applyPaletteItem(cmdWithArgs, ctx);
    expect(ctx.editor.valueRef.current).toBe('/reply ');
    expect(ctx.onSend).not.toHaveBeenCalled();
    expect(ctx.onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(ctx.onAbort).not.toHaveBeenCalled();
  });

  it('still blocked at position > 0 (commands only run at start)', () => {
    const ctx = makeCtx({
      initialText: 'hi /r',
      slashRange: { start: 3, end: 5, query: 'r' },
    });
    applyPaletteItem(cmdWithArgs, ctx);
    expect(ctx.resetEditor).not.toHaveBeenCalled();
  });
});

describe('palette-item-handlers / agent', () => {
  it('strips slash range, clears attachments, and calls onChatAgentChange', () => {
    const onChange = vi.fn();
    const ctx = makeCtx({
      initialText: '/sec',
      slashRange: { start: 0, end: 4, query: 'sec' },
      onChatAgentChange: onChange,
    });
    applyPaletteItem(agentItem, ctx);
    expect(ctx.editor.valueRef.current).toBe('');
    expect(ctx.resetEditor).toHaveBeenCalledWith({ nextText: '', caretOffset: 0 });
    expect(ctx.clearAttachments).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('secondary');
  });

  it('blocked when slash is not at start of composer', () => {
    const onChange = vi.fn();
    const ctx = makeCtx({
      initialText: 'hi /sec',
      slashRange: { start: 3, end: 7, query: 'sec' },
      onChatAgentChange: onChange,
    });
    applyPaletteItem(agentItem, ctx);
    expect(onChange).not.toHaveBeenCalled();
    expect(ctx.resetEditor).not.toHaveBeenCalled();
  });

  it('allowed while runBusy now (guard removed)', () => {
    const onChange = vi.fn();
    const ctx = makeCtx({
      initialText: '/sec',
      slashRange: { start: 0, end: 4, query: 'sec' },
      runBusy: true,
      onChatAgentChange: onChange,
    });
    applyPaletteItem(agentItem, ctx);
    expect(onChange).toHaveBeenCalledWith('secondary');
    expect(ctx.editor.valueRef.current).toBe('');
    expect(ctx.clearAttachments).toHaveBeenCalledTimes(1);
  });

  it('no-op when onChatAgentChange is not provided', () => {
    const ctx = makeCtx({
      initialText: '/sec',
      slashRange: { start: 0, end: 4, query: 'sec' },
    });
    ctx.callbacks.onChatAgentChange = undefined;
    applyPaletteItem(agentItem, ctx);
    expect(ctx.resetEditor).not.toHaveBeenCalled();
    expect(ctx.clearAttachments).not.toHaveBeenCalled();
  });
});

describe('applyPaletteItem unknown kind', () => {
  it('is a no-op for an unregistered kind', () => {
    const ctx = makeCtx({
      initialText: '/x',
      slashRange: { start: 0, end: 2, query: 'x' },
    });
    const fakeItem = { ...skillItem, kind: 'mcp' as unknown as PaletteItem['kind'] };
    applyPaletteItem(fakeItem, ctx);
    expect(ctx.resetEditor).not.toHaveBeenCalled();
    expect(ctx.onSend).not.toHaveBeenCalled();
  });
});
