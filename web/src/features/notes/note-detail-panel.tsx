import { ArrowLeft, Eye, Code2, FileText } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import useSWR from 'swr';

import { BlockEditor } from '@/components/block-editor';
import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useThemeStore } from '@/stores/theme-store';

import { getNote, updateNote } from './notes-api';

type EditorMode = 'wysiwyg' | 'source' | 'preview';

export type NoteDetailPanelProps = {
  noteId: string;
  onBack: () => void;
  onSaved?: () => void;
};

export function NoteDetailPanel({ noteId, onBack, onSaved }: NoteDetailPanelProps) {
  const isDark = useThemeStore((s) => s.resolved) === 'dark';
  const [mode, setMode] = useState<EditorMode>('wysiwyg');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: note, mutate } = useSWR(
    noteId ? ['note-detail', noteId] : null,
    () => getNote(noteId),
  );

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

  const time = note
    ? new Date(note.createdAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 truncate text-sm text-fg-muted">
          {time}
          {saving && <span className="ml-2 text-xs text-fg-muted opacity-60">Saving…</span>}
        </span>

        {/* Mode switcher */}
        <div className="flex items-center gap-0.5 rounded-lg border border-edge p-0.5">
          <Button
            variant="ghost"
            className={cn(
              'gap-1 px-2 py-1 text-xs',
              mode === 'wysiwyg' && 'bg-surface-hover text-fg',
            )}
            onClick={() => setMode('wysiwyg')}
          >
            <FileText className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            className={cn(
              'gap-1 px-2 py-1 text-xs',
              mode === 'source' && 'bg-surface-hover text-fg',
            )}
            onClick={() => setMode('source')}
          >
            <Code2 className="h-3.5 w-3.5" />
            Source
          </Button>
          <Button
            variant="ghost"
            className={cn(
              'gap-1 px-2 py-1 text-xs',
              mode === 'preview' && 'bg-surface-hover text-fg',
            )}
            onClick={() => setMode('preview')}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
        </div>
      </div>

      {/* Body */}
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
              <p className="italic text-fg-muted">Empty note — switch to Edit to start writing.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
