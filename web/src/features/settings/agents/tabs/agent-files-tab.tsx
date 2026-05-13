import { Eye, SquarePen } from 'lucide-react';

import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { useThemeStore } from '@/stores/theme-store';

import { agentsSettingsInputClass } from '../utils';

export function AgentFilesTab(props: {
  a: AgentsSettingsMessages;
  filesLoading: boolean;
  files: { files: { name: string; missing: boolean }[] } | null;
  activeFile: string | null;
  setActiveFile: (name: string) => void;
  filesViewMode: 'edit' | 'preview';
  setFilesViewMode: (m: 'edit' | 'preview') => void;
  fileDraft: string;
  setFileDraft: (v: string) => void;
  fileSaving: boolean;
  profileFileLoading: boolean;
  /** Bumps when profile Markdown body is loaded from the server (remounts CodeMirror). */
  profileEditorNonce: number;
}) {
  const {
    a,
    filesLoading,
    files,
    activeFile,
    setActiveFile,
    filesViewMode,
    setFilesViewMode,
    fileDraft,
    setFileDraft,
    fileSaving,
    profileFileLoading,
    profileEditorNonce,
  } = props;

  const isDark = useThemeStore((s) => s.resolved === 'dark');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <p className="shrink-0 text-sm text-fg-muted">{a.filesHint}</p>
      {filesLoading ? (
        <p className="shrink-0 text-sm text-fg-muted">{a.filesLoading}</p>
      ) : files ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <nav
            className="flex shrink-0 flex-row flex-wrap gap-x-0.5 gap-y-0 border-b border-edge-subtle"
            aria-label={a.navCoreFiles}
          >
            {files.files.map((f) => (
              <button
                key={f.name}
                type="button"
                className={cn(
                  '-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-left font-mono text-xs whitespace-nowrap transition-colors',
                  activeFile === f.name
                    ? 'border-accent text-fg'
                    : 'text-fg-muted hover:border-edge-subtle hover:text-fg',
                  f.missing && 'opacity-60',
                )}
                onClick={() => setActiveFile(f.name)}
              >
                {f.name}
                {f.missing ? ` (${a.missing})` : ''}
              </button>
            ))}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
            {activeFile ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <div
                    className="inline-flex rounded-lg border border-edge bg-surface-panel p-0.5"
                    role="group"
                    aria-label={`${a.filesMarkdownEdit} / ${a.filesMarkdownPreview}`}
                  >
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                        filesViewMode === 'edit'
                          ? 'bg-accent-soft text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover',
                      )}
                      onClick={() => setFilesViewMode('edit')}
                    >
                      <SquarePen className="size-3.5 shrink-0" aria-hidden />
                      {a.filesMarkdownEdit}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                        filesViewMode === 'preview'
                          ? 'bg-accent-soft text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover',
                      )}
                      onClick={() => setFilesViewMode('preview')}
                    >
                      <Eye className="size-3.5 shrink-0" aria-hidden />
                      {a.filesMarkdownPreview}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    {fileSaving ? <span>{a.filesSavingStatus}</span> : null}
                    <span>{a.filesAutoSaveHint}</span>
                  </div>
                </div>
                {filesViewMode === 'edit' ? (
                  <div
                    className={cn(
                      agentsSettingsInputClass(),
                      'flex min-h-0 flex-1 flex-col overflow-hidden p-0',
                      profileFileLoading && 'pointer-events-none opacity-60',
                    )}
                  >
                    <MarkdownEditor
                      key={`${activeFile ?? 'file'}-${profileEditorNonce}`}
                      initialContent={fileDraft}
                      onChange={setFileDraft}
                      isDark={isDark}
                      className="min-h-0 flex-1"
                    />
                  </div>
                ) : (
                  <div
                    className={cn(
                      agentsSettingsInputClass(),
                      'min-h-0 flex-1 overflow-y-auto text-sm',
                      profileFileLoading && 'pointer-events-none opacity-60',
                    )}
                  >
                    <MarkdownView content={fileDraft} className="text-sm" />
                  </div>
                )}
              </>
            ) : (
              <p className="shrink-0 text-sm text-fg-muted">{a.pickFile}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="shrink-0 text-sm text-fg-muted">{a.filesEmpty}</p>
      )}
    </div>
  );
}
