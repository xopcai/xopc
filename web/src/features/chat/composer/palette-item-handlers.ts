import type { MutableRefObject } from 'react';

import type { ComposerContextRef, ResetEditorOptions, WireAttachment } from '@/features/chat/composer/composer.types';
import type {
  PaletteItem,
  PaletteItemKind,
  SlashRange,
} from '@/features/chat/palette/command-palette.types';

/**
 * Slash commands that mean "stop the current generation right now". When `runBusy`,
 * selecting one of these in the palette routes through `onAbort()` instead of either
 * sending immediately or queueing — queueing an abort is meaningless.
 *
 * Kept in sync with `src/chat-commands/builtins/session.ts` (`abortCommand` + its aliases).
 */
export const ABORT_CLASS_NAMES: ReadonlySet<string> = new Set(['abort', 'stop', 'cancel']);

function isAbortClassCommand(item: PaletteItem): boolean {
  if (item.kind !== 'command') return false;
  if (ABORT_CLASS_NAMES.has(item.name.toLowerCase())) return true;
  for (const alias of item.aliases ?? []) {
    if (ABORT_CLASS_NAMES.has(alias.toLowerCase())) return true;
  }
  return false;
}

export interface PaletteApplyContext {
  slashRange: SlashRange | null;
  /** `sending || streaming` for the active session. */
  runBusy: boolean;
  /** Mirrors `chat-composer-input.tsx`'s `steerKbdBusy = runBusy || pendingFollowUpsCount > 0`. */
  pendingFollowUpsCount: number;
  /** Cap from `pending-follow-up.types.ts` (`MAX_PENDING_FOLLOW_UPS`). */
  maxPendingFollowUps: number;
  thinkingLevel: string;
  editor: {
    valueRef: MutableRefObject<string>;
    resetEditor: (opts?: ResetEditorOptions) => void;
  };
  attachments: { clearAttachments: () => void };
  contextRefs: {
    current: ComposerContextRef[];
    clear: () => void;
  };
  callbacks: {
    onSend: (text: string, atts?: WireAttachment[], thinking?: string, contextRefs?: ComposerContextRef[]) => void;
    onUserTextCommitted?: (text: string) => void;
    /** Agent switch handler — wired by chat-page (writes localStorage + navigates to /chat/new). */
    onChatAgentChange?: (agentId: string) => void;
    /** Used when runBusy and command is `acceptsArgs=false` non-abort: queue as follow-up. */
    onAddPendingFollowUp?: (text: string, atts?: WireAttachment[], contextRefs?: ComposerContextRef[]) => void | Promise<void>;
    /** Used when runBusy and command is abort-class: stop the current generation. */
    onAbort?: () => void;
    onUnavailableSkill?: (item: PaletteItem) => void;
    /** Opens the structured review launcher for the built-in `/review` command. */
    onReviewLauncher?: () => void;
    onAddContextRef?: (ref: ComposerContextRef) => void;
  };
}

export type PaletteItemHandler = (item: PaletteItem, ctx: PaletteApplyContext) => void;

export function replaceRange(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

const applySkillItem: PaletteItemHandler = (item, ctx) => {
  const range = ctx.slashRange;
  if (!range) return;
  if (item.availability?.status && item.availability.status !== 'available') {
    ctx.callbacks.onUnavailableSkill?.(item);
    return;
  }
  const insert = `/skill:${item.name} `;
  const next = replaceRange(ctx.editor.valueRef.current, range.start, range.end, insert);
  const pos = range.start + insert.length;
  ctx.editor.resetEditor({ nextText: next, caretOffset: pos, focus: true });
};

const applyCommandItem: PaletteItemHandler = (item, ctx) => {
  const range = ctx.slashRange;
  if (!range) return;
  // Slash commands only run at position 0 (parent filtered already; guard for safety).
  if (range.start !== 0) return;

  if (
    item.name.toLowerCase() === 'review' &&
    ctx.callbacks.onReviewLauncher &&
    !ctx.runBusy &&
    ctx.pendingFollowUpsCount === 0
  ) {
    const v = ctx.editor.valueRef.current;
    const next = v.slice(0, range.start) + v.slice(range.end);
    ctx.editor.resetEditor({ nextText: next, caretOffset: range.start, focus: true });
    ctx.callbacks.onReviewLauncher();
    return;
  }

  const accepts = item.acceptsArgs === true;

  // args=true: insert placeholder text only — same as a skill, runBusy is irrelevant.
  if (accepts) {
    const insert = `/${item.name} `;
    const next = replaceRange(ctx.editor.valueRef.current, range.start, range.end, insert);
    const pos = range.start + insert.length;
    ctx.editor.resetEditor({ nextText: next, caretOffset: pos, focus: true });
    return;
  }

  const cmd = `/${item.name}`;
  const streamLike = ctx.runBusy || ctx.pendingFollowUpsCount > 0;

  if (streamLike) {
    // Abort-class: stop the current generation. Do not queue; do not send a message.
    if (isAbortClassCommand(item)) {
      if (!ctx.callbacks.onAbort) return;
      ctx.callbacks.onAbort();
      const v = ctx.editor.valueRef.current;
      const next = v.slice(0, range.start) + v.slice(range.end);
      ctx.editor.resetEditor({ nextText: next, caretOffset: range.start });
      return;
    }
    // Non-abort args=false command: queue as a pending follow-up — same semantics as
    // typing `/cmd` in the editor and pressing Enter while runBusy.
    if (!ctx.callbacks.onAddPendingFollowUp) return;
    if (ctx.pendingFollowUpsCount >= ctx.maxPendingFollowUps) return;
    if (ctx.contextRefs.current.length) {
      void ctx.callbacks.onAddPendingFollowUp(cmd, undefined, ctx.contextRefs.current);
    } else {
      void ctx.callbacks.onAddPendingFollowUp(cmd, undefined);
    }
    ctx.callbacks.onUserTextCommitted?.(cmd);
    ctx.attachments.clearAttachments();
    ctx.contextRefs.clear();
    ctx.editor.resetEditor();
    return;
  }

  // Idle: send immediately (unchanged from prior behavior).
  if (ctx.contextRefs.current.length) {
    ctx.callbacks.onSend(cmd, undefined, ctx.thinkingLevel, ctx.contextRefs.current);
  } else {
    ctx.callbacks.onSend(cmd, undefined, ctx.thinkingLevel);
  }
  ctx.callbacks.onUserTextCommitted?.(cmd);
  ctx.attachments.clearAttachments();
  ctx.contextRefs.clear();
  ctx.editor.resetEditor();
};

const applyAgentItem: PaletteItemHandler = (item, ctx) => {
  const range = ctx.slashRange;
  if (!range) return;
  // Agent switching is sentence-level; only at start of composer.
  if (range.start !== 0) return;
  if (!ctx.callbacks.onChatAgentChange) return;

  // Strip the slash token from the editor before navigating; otherwise the next
  // session boots with leftover `/` text.
  const v = ctx.editor.valueRef.current;
  const next = v.slice(0, range.start) + v.slice(range.end);
  ctx.editor.resetEditor({ nextText: next, caretOffset: range.start });
  ctx.attachments.clearAttachments();
  ctx.callbacks.onChatAgentChange(item.name);
};

const applyNoteItem: PaletteItemHandler = (item, ctx) => {
  const range = ctx.slashRange;
  if (!range || !item.noteRef || !ctx.callbacks.onAddContextRef) return;
  const next = replaceRange(ctx.editor.valueRef.current, range.start, range.end, '');
  ctx.editor.resetEditor({ nextText: next, caretOffset: range.start, focus: true });
  ctx.callbacks.onAddContextRef({
    kind: 'note',
    sourceId: item.noteRef.sourceId,
    expectedVersion: item.noteRef.expectedVersion,
    title: item.name,
  });
};

export const paletteItemHandlers: Record<PaletteItemKind, PaletteItemHandler> = {
  skill: applySkillItem,
  command: applyCommandItem,
  agent: applyAgentItem,
  note: applyNoteItem,
};

export function applyPaletteItem(item: PaletteItem, ctx: PaletteApplyContext): void {
  const handler = paletteItemHandlers[item.kind];
  if (!handler) return;
  handler(item, ctx);
}
