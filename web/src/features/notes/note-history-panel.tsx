import { History, Pencil, Sparkles, RefreshCw, ArrowDownToLine, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { cn } from '@/lib/cn';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';
import { messages } from '@/i18n/messages';

import {
  listNoteHistory,
  restoreNoteSnapshot,
  type NoteSnapshotEntry,
  type SnapshotTrigger,
} from './notes-api';
import { formatRelativeTime, type NoteTimeLabels } from './note-time';

const TRIGGER_ICONS: Record<SnapshotTrigger, typeof Pencil> = {
  edit: Pencil,
  ai_edit: Sparkles,
  sync: RefreshCw,
  restore: ArrowDownToLine,
};

function triggerLabel(trigger: SnapshotTrigger, n: Record<string, string>): string {
  const map: Record<SnapshotTrigger, string> = {
    edit: n.triggerEdit,
    ai_edit: n.triggerAiEdit,
    sync: n.triggerSync,
    restore: n.triggerRestore,
  };
  return map[trigger] ?? trigger;
}

export type NoteHistoryPanelProps = {
  noteId: string;
  activeTimestamp: number | null;
  onSelect: (entry: NoteSnapshotEntry) => void;
  onClose: () => void;
  onRestored: () => void;
};

export function NoteHistoryPanel({ noteId, activeTimestamp, onSelect, onClose, onRestored }: NoteHistoryPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const timeLabels: NoteTimeLabels = n;

  const { data: entries } = useSWR(
    noteId ? ['note-history', noteId] : null,
    () => listNoteHistory(noteId),
  );

  const [restoring, setRestoring] = useState(false);
  const [confirmTimestamp, setConfirmTimestamp] = useState<number | null>(null);

  const handleRestore = useCallback(
    async (timestamp: number) => {
      setRestoring(true);
      try {
        await restoreNoteSnapshot(noteId, timestamp);
        setConfirmTimestamp(null);
        onRestored();
      } catch {
        showToast({ type: 'error', title: n.restoreFailed });
      } finally {
        setRestoring(false);
      }
    },
    [noteId, n.restoreSuccess, n.restoreFailed, onRestored],
  );

  const now = Date.now();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <History className="size-4" aria-hidden />
          {n.history}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!entries?.length ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-fg-muted">{n.historyEmpty}</p>
            <p className="mt-1 text-xs text-fg-muted/60">{n.historyEmptyDescription}</p>
          </div>
        ) : (
          <ul className="divide-y divide-edge">
            {entries.map((entry) => {
              const Icon = TRIGGER_ICONS[entry.trigger] ?? Pencil;
              const isActive = activeTimestamp === entry.timestamp;
              const isConfirming = confirmTimestamp === entry.timestamp;
              return (
                <li key={entry.timestamp}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry)}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors',
                      isActive ? 'bg-accent/10' : 'hover:bg-surface-hover',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                      <span className="text-xs font-medium text-fg">
                        {triggerLabel(entry.trigger, n)}
                      </span>
                      <span className="ml-auto text-xs text-fg-muted">
                        {formatRelativeTime(entry.timestamp, now, timeLabels)}
                      </span>
                    </div>
                    {entry.snippet && (
                      <p className="mt-1 truncate text-xs text-fg-muted/60">{entry.snippet}</p>
                    )}
                  </button>
                  {isActive && (
                    <div className="border-t border-edge/50 px-4 py-2">
                      {isConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-xs text-fg-muted">{n.restoreConfirm}</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRestore(entry.timestamp); }}
                            disabled={restoring}
                            className="shrink-0 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-50"
                          >
                            {restoring ? '...' : n.restore}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmTimestamp(null); }}
                            className="shrink-0 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setConfirmTimestamp(entry.timestamp); }}
                          className="rounded-lg bg-surface-hover px-3 py-1 text-xs font-medium text-fg transition-colors hover:bg-accent hover:text-on-accent"
                        >
                          {n.restore}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
