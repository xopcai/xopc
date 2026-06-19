import { useCallback, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';

import {
  applyPaletteItem,
  replaceRange,
  type PaletteApplyContext,
} from '@/features/chat/composer/palette-item-handlers';
import type { PickerKeyAdapter } from '@/features/chat/composer/picker-key-adapter';
import type { ResetEditorOptions, WireAttachment } from '@/features/chat/composer/composer.types';
import { useDismissOnOutsideClick } from '@/features/chat/composer/use-dismiss-on-outside-click';
import type { AtMentionItem } from '@/features/chat/palette/at-mention-api';
import { recordRecentAtPath } from '@/features/chat/palette/at-mention-recent';
import type { PaletteItem } from '@/features/chat/palette/command-palette.types';
import { formatFilePathForWire } from '@/features/chat/palette/file-wire-pattern';
import {
  browseDirFromQuery,
  browseParentDir,
  detectAtRange,
  useAtMentionPicker,
} from '@/features/chat/palette/use-at-mention-picker';
import { commandRowDisabled, useCommandPalette } from '@/features/chat/palette/use-command-palette';

export interface UseComposerPickersOptions {
  sessionKey: string | null;
  editorValue: string;
  editorCursor: number;
  isComposing: boolean;
  runBusy: boolean;
  thinkingLevel: string;

  editorRef: MutableRefObject<HTMLDivElement | null>;
  valueRef: MutableRefObject<string>;
  resetEditor: (opts?: ResetEditorOptions) => void;
  clearAttachments: () => void;

  onSend: (text: string, atts?: WireAttachment[], thinking?: string) => void;
  onUserTextCommitted?: (text: string) => void;
  /** Optional: when set, palette can offer agent rows that switch the active session agent. */
  onChatAgentChange?: (agentId: string) => void;
  /** Active session agent id; used to resolve skill availability in `/` palette. */
  currentAgentId?: string;
  onUnavailableSkill?: (item: PaletteItem) => void;
  /** When runBusy and command is `acceptsArgs=false` non-abort: queue the command. */
  onAddPendingFollowUp?: (text: string, atts?: WireAttachment[]) => void | Promise<void>;
  /** When runBusy and command is abort-class: stop the current generation. */
  onAbort?: () => void;
  /** Treat as stream-like for command-queue/disable decisions even when not currently streaming. */
  pendingFollowUpsCount: number;
  maxPendingFollowUps: number;

  /** Anchor for the slash-palette outside-click dismiss (the floating panel itself). */
  commandPalettePanelRef: RefObject<HTMLDivElement | null>;
}

export interface UseComposerPickersReturn {
  palette: ReturnType<typeof useCommandPalette>;
  atPicker: ReturnType<typeof useAtMentionPicker>;
  /** True iff some picker / at-range is open — parent uses this to drive selectionchange sync. */
  shouldSyncSelection: boolean;
  /** In-order priority list for `dispatchPickerKey`. */
  adapters: readonly PickerKeyAdapter[];
  /** Externally invoked when user clicks a row in the slash palette. */
  applyPalette: (item: PaletteItem) => void;
  /** Externally invoked when user clicks a row in the @-mention picker. */
  applyAtMention: (item: AtMentionItem, opts?: { stayOpen?: boolean }) => void;
}

/**
 * Composes the slash palette and @-mention pickers, their mutual exclusion, the keyboard adapters,
 * and the outside-click dismiss for the slash palette. ChatComposer wires the returned `adapters`
 * to its `<ChatComposerInput>`; nothing else changes about how each picker hook works internally.
 */
export function useComposerPickers(opts: UseComposerPickersOptions): UseComposerPickersReturn {
  const {
    sessionKey,
    editorValue,
    editorCursor,
    isComposing,
    runBusy,
    thinkingLevel,
    editorRef,
    valueRef,
    resetEditor,
    clearAttachments,
    onSend,
    onUserTextCommitted,
    onChatAgentChange,
    currentAgentId,
    onUnavailableSkill,
    onAddPendingFollowUp,
    onAbort,
    pendingFollowUpsCount,
    maxPendingFollowUps,
    commandPalettePanelRef,
  } = opts;

  const atRangeRaw = useMemo(
    () => detectAtRange(editorValue, editorCursor),
    [editorValue, editorCursor],
  );
  const palette = useCommandPalette(editorValue, editorCursor, {
    suppress: atRangeRaw != null,
    isComposing,
    currentAgentId,
  });
  const atPicker = useAtMentionPicker(editorValue, editorCursor, {
    sessionKey,
    slashPaletteOpen: palette.open,
    isComposing,
    precomputedAtRange: atRangeRaw,
  });

  const shouldSyncSelection = palette.open || atPicker.open || atRangeRaw != null;

  // ── Apply functions ─────────────────────────────────────────────

  const buildPaletteCtx = useCallback(
    (): PaletteApplyContext => ({
      slashRange: palette.slashRange,
      runBusy,
      pendingFollowUpsCount,
      maxPendingFollowUps,
      thinkingLevel,
      editor: { valueRef, resetEditor },
      attachments: { clearAttachments },
      callbacks: {
        onSend,
        onUserTextCommitted,
        onChatAgentChange,
        onAddPendingFollowUp,
        onAbort,
        onUnavailableSkill,
      },
    }),
    [
      palette.slashRange,
      runBusy,
      pendingFollowUpsCount,
      maxPendingFollowUps,
      thinkingLevel,
      valueRef,
      resetEditor,
      clearAttachments,
      onSend,
      onUserTextCommitted,
      onChatAgentChange,
      onAddPendingFollowUp,
      onAbort,
      onUnavailableSkill,
    ],
  );

  const applyPalette = useCallback(
    (item: PaletteItem) => {
      applyPaletteItem(item, buildPaletteCtx());
    },
    [buildPaletteCtx],
  );

  const applyAtMention = useCallback(
    (item: AtMentionItem, applyOpts?: { stayOpen?: boolean }) => {
      const range = atPicker.atRange;
      if (!range) return;
      if (item.isBrowseUp) {
        const dir = browseDirFromQuery(range.query);
        const parentDir = browseParentDir(dir);
        const newQuery = parentDir ? `${parentDir}/` : '';
        const insert = `@${newQuery}`;
        const next = replaceRange(valueRef.current, range.start, range.end, insert);
        const pos = range.start + insert.length;
        resetEditor({ nextText: next, caretOffset: pos, focus: true });
        return;
      }

      const path =
        item.isDirectory && !item.relativePath.endsWith('/')
          ? `${item.relativePath}/`
          : item.relativePath;

      const wire = `@file:${formatFilePathForWire(path)}`;

      if (sessionKey && !item.isDirectory) {
        recordRecentAtPath(sessionKey, path.replace(/\/$/, ''));
      }

      const suffix = applyOpts?.stayOpen ? ' @' : ' ';
      const insert = wire + suffix;
      const next = replaceRange(valueRef.current, range.start, range.end, insert);
      const pos = range.start + insert.length;
      resetEditor({ nextText: next, caretOffset: pos, focus: true });
    },
    [atPicker.atRange, sessionKey, valueRef, resetEditor],
  );

  // ── Outside-click dismiss for the slash palette ─────────────────

  const paletteSlashRangeRef = useRef(palette.slashRange);
  paletteSlashRangeRef.current = palette.slashRange;
  const valueRefRef = valueRef;

  const dismissPalette = useCallback(() => {
    const range = paletteSlashRangeRef.current;
    if (!range) return;
    const v = valueRefRef.current;
    const next = v.slice(0, range.start) + v.slice(range.end);
    resetEditor({ nextText: next, caretOffset: range.start });
  }, [resetEditor, valueRefRef]);

  const dismissAnchors = useMemo(
    () => [editorRef, commandPalettePanelRef],
    [editorRef, commandPalettePanelRef],
  );

  useDismissOnOutsideClick({
    active: palette.open,
    anchors: dismissAnchors,
    ignoreSelector: '[data-slash-palette-tooltip]',
    onDismiss: dismissPalette,
  });

  // ── Keyboard adapters ───────────────────────────────────────────

  // Latest values are read inside the adapter via refs so we don't recompute the adapters
  // on every keystroke (and to ensure ChatComposerInput stays memoized).
  const atPickerRef = useRef(atPicker);
  atPickerRef.current = atPicker;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const isComposingRef = useRef(isComposing);
  isComposingRef.current = isComposing;
  const applyPaletteRef = useRef(applyPalette);
  applyPaletteRef.current = applyPalette;
  const applyAtMentionRef = useRef(applyAtMention);
  applyAtMentionRef.current = applyAtMention;
  const disabledCtxRef = useRef({ runBusy, pendingFollowUpsCount, maxPendingFollowUps });
  disabledCtxRef.current = { runBusy, pendingFollowUpsCount, maxPendingFollowUps };

  const atMentionAdapter = useMemo<PickerKeyAdapter>(
    () => ({
      name: 'at-mention',
      isActive: () => {
        const ap = atPickerRef.current;
        return ap.open && ap.atRange != null && !isComposingRef.current;
      },
      handleKey: (e) => {
        const ap = atPickerRef.current;
        if (!ap.atRange) return false;
        if (e.key === 'Escape') {
          e.preventDefault();
          const range = ap.atRange;
          const v = valueRefRef.current;
          const next = replaceRange(v, range.start, range.end, '');
          resetEditor({ nextText: next, caretOffset: range.start, focus: true });
          return true;
        }
        if (ap.items.length === 0) return false;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          ap.onNavigate('down');
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          ap.onNavigate('up');
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const item = ap.items[ap.selectedIndex];
          if (item) applyAtMentionRef.current(item, { stayOpen: e.shiftKey });
          return true;
        }
        return false;
      },
    }),
    [resetEditor, valueRefRef],
  );

  const paletteAdapter = useMemo<PickerKeyAdapter>(
    () => ({
      name: 'slash-palette',
      isActive: () => paletteRef.current.open && !isComposingRef.current,
      handleKey: (e) => {
        const p = paletteRef.current;
        if (p.items.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            p.onNavigate('down');
            return true;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            p.onNavigate('up');
            return true;
          }
          if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
            e.preventDefault();
            const item = p.items[p.selectedIndex];
            if (!item) return true;
            // Disabled row (e.g. queue full): consume the key so the global Enter
            // doesn't send the editor draft, but do nothing else — tooltip already
            // explains why. ArrowUp/Down still navigate so the user can move off.
            if (commandRowDisabled(item, disabledCtxRef.current)) {
              return true;
            }
            applyPaletteRef.current(item);
            return true;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const range = p.slashRange;
          if (range) {
            const v = valueRefRef.current;
            const next = replaceRange(v, range.start, range.end, '');
            resetEditor({ nextText: next, caretOffset: range.start, focus: true });
          }
          return true;
        }
        return false;
      },
    }),
    [resetEditor, valueRefRef],
  );

  // at-mention takes precedence over slash palette (mirrors original `chat-composer-input.tsx`).
  const adapters = useMemo<readonly PickerKeyAdapter[]>(
    () => [atMentionAdapter, paletteAdapter],
    [atMentionAdapter, paletteAdapter],
  );

  return {
    palette,
    atPicker,
    shouldSyncSelection,
    adapters,
    applyPalette,
    applyAtMention,
  };
}
