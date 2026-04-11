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
  bootstrapViewMode: 'edit' | 'preview';
  setBootstrapViewMode: (m: 'edit' | 'preview') => void;
  fileDraft: string;
  setFileDraft: (v: string) => void;
  fileSaving: boolean;
  bootstrapFileLoading: boolean;
  /** Bumps when bootstrap file body is loaded from the server (remounts CodeMirror). */
  bootstrapEditorNonce: number;
}) {
  const {
    a,
    filesLoading,
    files,
    activeFile,
    setActiveFile,
    bootstrapViewMode,
    setBootstrapViewMode,
    fileDraft,
    setFileDraft,
    fileSaving,
    bootstrapFileLoading,
    bootstrapEditorNonce,
  } = props;

  const isDark = useThemeStore((s) => s.resolved === 'dark');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">{a.filesHint}</p>
      {filesLoading ? (
        <p className="text-sm text-fg-muted">{a.filesLoading}</p>
      ) : files ? (
        <div className="flex min-h-0 flex-col gap-3">
          <nav
            className="flex flex-row flex-wrap gap-x-0.5 gap-y-0 border-b border-edge-subtle"
            aria-label={a.tabFiles}
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
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            {activeFile ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    className="inline-flex rounded-lg border border-edge bg-surface-panel p-0.5"
                    role="group"
                    aria-label={a.filesBootstrapEdit}
                  >
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                        bootstrapViewMode === 'edit'
                          ? 'bg-accent-soft text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover',
                      )}
                      onClick={() => setBootstrapViewMode('edit')}
                    >
                      <SquarePen className="size-3.5 shrink-0" aria-hidden />
                      {a.filesBootstrapEdit}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                        bootstrapViewMode === 'preview'
                          ? 'bg-accent-soft text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover',
                      )}
                      onClick={() => setBootstrapViewMode('preview')}
                    >
                      <Eye className="size-3.5 shrink-0" aria-hidden />
                      {a.filesBootstrapPreview}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    {fileSaving ? <span>{a.filesSavingStatus}</span> : null}
                    <span>{a.filesAutoSaveHint}</span>
                  </div>
                </div>
                {bootstrapViewMode === 'edit' ? (
                  <div
                    className={cn(
                      agentsSettingsInputClass(),
                      'min-h-[min(36rem,65vh)] flex-1 overflow-hidden p-0 sm:min-h-[40rem]',
                      bootstrapFileLoading && 'pointer-events-none opacity-60',
                    )}
                  >
                    <MarkdownEditor
                      key={`${activeFile ?? 'file'}-${bootstrapEditorNonce}`}
                      initialContent={fileDraft}
                      onChange={setFileDraft}
                      isDark={isDark}
                      className="min-h-[min(36rem,65vh)] sm:min-h-[40rem]"
                    />
                  </div>
                ) : (
                  <div
                    className={cn(
                      agentsSettingsInputClass(),
                      'min-h-[min(36rem,65vh)] flex-1 overflow-auto text-sm sm:min-h-[40rem]',
                      bootstrapFileLoading && 'pointer-events-none opacity-60',
                    )}
                  >
                    <MarkdownView content={fileDraft} className="text-sm" />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-fg-muted">{a.pickFile}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{a.filesEmpty}</p>
      )}
    </div>
  );
}
