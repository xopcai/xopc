import { Download, Eye, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { MarkdownSplit } from '@/components/markdown/markdown-split';
import { MarkdownView } from '@/components/markdown/markdown-view';
import {
  downloadTextFile,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '@/features/workspace/workspace-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

export function getFileExtension(path: string): string {
  const i = path.lastIndexOf('.');
  if (i <= 0 || i === path.length - 1) return '';
  return path.slice(i).toLowerCase();
}

export function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function wrapInCodeFence(content: string, extension: string): string {
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.js': 'javascript',
    '.json': 'json',
  };
  const lang = langMap[extension] ?? 'plaintext';
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

export interface WorkspaceFilePreviewPanelProps {
  filePath: string | null;
  onClose: () => void;
}

export function WorkspaceFilePreviewPanel({ filePath, onClose }: WorkspaceFilePreviewPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const resolvedTheme = useThemeStore((s) => s.resolved);

  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [markdownEditMode, setMarkdownEditMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveStatusClearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setMarkdownEditMode(false);
  }, [filePath]);

  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setContent(null);

    void readWorkspaceFile(filePath)
      .then(({ content: text }) => {
        if (!cancelled) {
          setContent(text);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const handleMarkdownSave = useCallback(
    async (newContent: string) => {
      if (!filePath) return;
      if (saveStatusClearRef.current !== undefined) {
        clearTimeout(saveStatusClearRef.current);
        saveStatusClearRef.current = undefined;
      }
      setSaveStatus('saving');
      try {
        await writeWorkspaceFile(filePath, newContent);
        setSaveStatus('saved');
        saveStatusClearRef.current = setTimeout(() => {
          setSaveStatus('idle');
          saveStatusClearRef.current = undefined;
        }, 2000);
      } catch {
        setSaveStatus('idle');
      }
    },
    [filePath],
  );

  const ext = filePath ? getFileExtension(filePath) : '';
  const name = filePath ? getFileName(filePath) : '';
  const isMd = ext === '.md';

  const handleDownload = useCallback(() => {
    if (content == null || !filePath) return;
    downloadTextFile(name, content);
  }, [content, filePath, name]);

  if (!filePath) {
    return null;
  }

  let body: ReactNode = null;
  if (loading) {
    body = <p className="px-4 py-6 text-sm text-fg-muted">{m.chat.loading}</p>;
  } else if (loadError) {
    body = (
      <p className="px-4 py-6 text-sm text-red-600 dark:text-red-400">
        {m.workspace.loadError}: {loadError}
      </p>
    );
  } else if (content !== null) {
    if (isMd && markdownEditMode) {
      body = (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MarkdownSplit
            key={filePath}
            initialContent={content}
            onSave={handleMarkdownSave}
            isDark={resolvedTheme === 'dark'}
          />
        </div>
      );
    } else if (isMd) {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView content={content} />
        </div>
      );
    } else if (ext === '.ts' || ext === '.js') {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView content={wrapInCodeFence(content, ext)} />
        </div>
      );
    } else if (ext === '.json') {
      let display = content;
      try {
        display = JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        /* keep raw */
      }
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView content={wrapInCodeFence(display, '.json')} />
        </div>
      );
    } else {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-fg">{content}</pre>
        </div>
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4 dark:border-edge">
        <h2
          className="min-w-0 flex-1 truncate text-base font-semibold leading-tight tracking-tight text-fg"
          title={name}
        >
          {name}
        </h2>
        {isMd && saveStatus !== 'idle' ? (
          <span className="shrink-0 text-xs leading-tight text-fg-muted">
            {saveStatus === 'saving' ? m.workspace.saving : m.workspace.saved}
          </span>
        ) : null}
        {isMd ? (
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            title={markdownEditMode ? m.workspace.viewing : m.workspace.edit}
            aria-label={markdownEditMode ? m.workspace.viewing : m.workspace.edit}
            onClick={() => setMarkdownEditMode((v) => !v)}
          >
            {markdownEditMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          title={m.workspace.download}
          aria-label={m.workspace.download}
          onClick={handleDownload}
          disabled={content == null || loading}
        >
          <Download className="size-4" />
        </button>
        <button
          type="button"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          title={m.workspace.close}
          aria-label={m.workspace.close}
          onClick={onClose}
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
}
