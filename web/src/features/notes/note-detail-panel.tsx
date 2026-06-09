import { ArrowLeft, Eye, Code2, FileText } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { BlockEditor } from '@/components/block-editor';
import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';

import { getNote, updateNote } from './notes-api';

type EditorMode = 'wysiwyg' | 'source' | 'preview';

function NoteDetailModeSwitcher({
  mode,
  onModeChange,
  labels,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  labels: { edit: string; source: string; preview: string };
}) {
  const modes = [
    { id: 'wysiwyg' as const, label: labels.edit, Icon: FileText },
    { id: 'source' as const, label: labels.source, Icon: Code2 },
    { id: 'preview' as const, label: labels.preview, Icon: Eye },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-edge p-0.5">
      {modes.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onModeChange(id)}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
            mode === id
              ? 'bg-surface-hover text-fg'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

export type NoteDetailPanelProps = {
  noteId: string;
  onBack: () => void;
  onSaved?: () => void;
};

export function NoteDetailPanel({ noteId, onBack, onSaved }: NoteDetailPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const isDark = useThemeStore((s) => s.resolved) === 'dark';
  const [mode, setMode] = useState<EditorMode>('wysiwyg');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const { data: note, mutate } = useSWR(
    noteId ? ['note-detail', noteId] : null,
    () => getNote(noteId),
  );

  const time = note
    ? new Date(note.createdAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const headerStart = useMemo(
    () => (
      <button
        type="button"
        onClick={onBack}
        aria-label={n.back}
        className={cn(
          'rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
          APP_CHROME_NO_DRAG_CLASS,
        )}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ),
    [n.back, onBack],
  );

  const headerMain = useMemo(
    () => (
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 px-3 sm:px-5 xl:px-6',
          APP_CHROME_NO_DRAG_CLASS,
        )}
      >
        <span className="min-w-0 truncate text-sm text-fg-muted" title={time || undefined}>
          {time}
          {saving ? <span className="ml-2 text-xs opacity-60">{n.saving}</span> : null}
        </span>
      </div>
    ),
    [n.saving, saving, time],
  );

  const headerEnd = useMemo(
    () => (
      <div className={APP_CHROME_NO_DRAG_CLASS}>
        <NoteDetailModeSwitcher
          mode={mode}
          onModeChange={setMode}
          labels={{ edit: n.modeEdit, source: n.modeSource, preview: n.modePreview }}
        />
      </div>
    ),
    [mode, n.modeEdit, n.modePreview, n.modeSource],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: headerStart,
      main: note ? headerMain : null,
      end: note ? headerEnd : null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, headerMain, headerStart, note, setPageHeader]);

  const handleSave = useCallback(
    (content: string) => {
      if (!noteId) return;

      // Debounce saves to avoid excessive API calls
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await updateNote(noteId, { text: content });
          await mutate();
          onSaved?.();
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [noteId, mutate, onSaved],
  );

  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'wysiwyg' && (
          <BlockEditor
            key={`wysiwyg-${noteId}`}
            initialContent={note.text ?? ''}
            onChange={handleSave}
            noteId={noteId}
          />
        )}
        {mode === 'source' && (
          <MarkdownEditor
            key={`source-${noteId}`}
            initialContent={note.text ?? ''}
            onChange={handleSave}
            isDark={isDark}
          />
        )}
        {mode === 'preview' && (
          <div className="h-full overflow-y-auto px-6 py-4">
            {note.text ? (
              <MarkdownView content={note.text} />
            ) : (
              <p className="italic text-fg-muted">{n.emptyPreview}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
