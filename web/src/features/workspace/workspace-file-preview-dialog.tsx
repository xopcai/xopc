import { Copy, Download, Eye, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { HtmlWorkspaceEditor } from '@/components/html/html-workspace-editor';
import { MarkdownSplit } from '@/components/markdown/markdown-split';
import { MarkdownView } from '@/components/markdown/markdown-view';
import {
  base64ToArrayBuffer,
  EXCEL_PREVIEW_MAX_COLS,
  EXCEL_PREVIEW_MAX_ROWS,
  inferMimeTypeFromFileName,
  PPTX_PREVIEW_MAX_CHARS,
} from '@/features/chat/attachment-utils-core';
import { PreviewOpenAlternativesBar } from '@/features/preview/preview-open-alternatives';
import { PptxPreviewView } from '@/features/preview/pptx-preview-view';
import {
  downloadBinaryFile,
  downloadTextFile,
  readWorkspaceFile,
  readWorkspaceFileBase64,
  writeWorkspaceFile,
} from '@/features/workspace/workspace-api';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
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

/** No in-browser preview — offer download / open externally only. */
const WORKSPACE_PREVIEW_BINARY_ONLY = new Set([
  '.doc',
  '.ppt',
  '.pps',
  '.zip',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.dmg',
  '.pkg',
  '.msi',
  '.bin',
  '.mp4',
  '.mp3',
  '.mov',
  '.wav',
]);

function formatWorkspaceFileMtime(mtimeMs: number, language: 'en' | 'zh'): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(mtimeMs));
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

function fillTemplate(template: string, params: Record<string, string | number>): string {
  let s = template;
  for (const [k, v] of Object.entries(params)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

type BinaryPreviewKind = 'pdf' | 'excel' | 'docx' | 'pptx' | 'binaryOnly';

export interface WorkspaceFilePreviewPanelProps {
  filePath: string | null;
  onClose: () => void;
  /** Per-chat session workspace (takes priority over `agentId`). */
  sessionKey?: string;
  /** Chat agent workspace; omit to use gateway default agent root. */
  agentId?: string;
}

export function WorkspaceFilePreviewPanel({
  filePath,
  onClose,
  sessionKey,
  agentId,
}: WorkspaceFilePreviewPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const resolvedTheme = useThemeStore((s) => s.resolved);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [binaryBuffer, setBinaryBuffer] = useState<ArrayBuffer | null>(null);
  const [previewKind, setPreviewKind] = useState<BinaryPreviewKind | 'text' | null>(null);
  const [hostAbsolutePath, setHostAbsolutePath] = useState<string | null>(null);
  const [binaryRenderError, setBinaryRenderError] = useState<string | null>(null);
  const [excelTruncated, setExcelTruncated] = useState(false);
  const [pptxPreviewText, setPptxPreviewText] = useState<string | null>(null);
  const [pptxTruncated, setPptxTruncated] = useState(false);
  const [pptxError, setPptxError] = useState<string | null>(null);
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [markdownEditMode, setMarkdownEditMode] = useState(false);
  /** false = iframe preview (default), true = CodeMirror source */
  const [htmlCodeMode, setHtmlCodeMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveStatusClearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const binaryPreviewRef = useRef<HTMLDivElement>(null);
  const binaryCleanupRef = useRef<(() => void) | null>(null);

  const readOpts = useMemo(() => {
    const sk = sessionKey?.trim();
    if (sk) return { sessionKey: sk };
    const aid = agentId?.trim();
    return aid ? { agentId: aid } : undefined;
  }, [sessionKey, agentId]);

  useEffect(() => {
    setMarkdownEditMode(false);
    setHtmlCodeMode(false);
  }, [filePath]);

  useEffect(() => {
    binaryCleanupRef.current?.();
    binaryCleanupRef.current = null;
    setBinaryRenderError(null);
    setExcelTruncated(false);
    setPptxPreviewText(null);
    setPptxTruncated(false);
    setPptxError(null);

    if (!filePath) {
      setTextContent(null);
      setBinaryBuffer(null);
      setPreviewKind(null);
      setHostAbsolutePath(null);
      setMtimeMs(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    const ext = getFileExtension(filePath);
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setTextContent(null);
    setBinaryBuffer(null);
    setPreviewKind(null);
    setHostAbsolutePath(null);
    setMtimeMs(null);

    const loadBinary = (kind: BinaryPreviewKind) => {
      void readWorkspaceFileBase64(filePath, readOpts)
        .then(({ contentBase64, mtimeMs: mt, absolutePath }) => {
          if (!cancelled) {
            setBinaryBuffer(base64ToArrayBuffer(contentBase64));
            setPreviewKind(kind);
            setHostAbsolutePath(typeof absolutePath === 'string' && absolutePath.length > 0 ? absolutePath : null);
            setMtimeMs(typeof mt === 'number' && Number.isFinite(mt) ? mt : null);
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
    };

    if (ext === '.pdf') {
      loadBinary('pdf');
    } else if (ext === '.xlsx' || ext === '.xls') {
      loadBinary('excel');
    } else if (ext === '.docx') {
      loadBinary('docx');
    } else if (ext === '.pptx') {
      loadBinary('pptx');
    } else if (WORKSPACE_PREVIEW_BINARY_ONLY.has(ext)) {
      loadBinary('binaryOnly');
    } else {
      void readWorkspaceFile(filePath, readOpts)
        .then(({ content: text, mtimeMs: mt }) => {
          if (!cancelled) {
            setTextContent(text);
            setPreviewKind('text');
            setMtimeMs(typeof mt === 'number' && Number.isFinite(mt) ? mt : null);
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
    }

    return () => {
      cancelled = true;
    };
  }, [filePath, readOpts]);

  useEffect(() => {
    if (!binaryBuffer || previewKind !== 'pptx' || !filePath) {
      return;
    }
    let cancelled = false;
    setPptxPreviewText(null);
    setPptxTruncated(false);
    setPptxError(null);

    const pptxName = getFileName(filePath);

    void (async () => {
      try {
        const mod = await import('@/features/chat/attachment-process-heavy');
        const { extractedText } = await mod.processPptx(binaryBuffer, pptxName);
        if (cancelled) return;
        const cap = PPTX_PREVIEW_MAX_CHARS;
        const truncated = extractedText.length > cap;
        setPptxPreviewText(truncated ? extractedText.slice(0, cap) : extractedText);
        setPptxTruncated(truncated);
      } catch (e) {
        if (!cancelled) {
          setPptxError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [binaryBuffer, previewKind, filePath]);

  useLayoutEffect(() => {
    binaryCleanupRef.current?.();
    binaryCleanupRef.current = null;
    setBinaryRenderError(null);
    setExcelTruncated(false);

    if (!binaryBuffer || !filePath || !previewKind) return;
    if (previewKind === 'binaryOnly' || previewKind === 'text' || previewKind === 'pptx') return;

    const el = binaryPreviewRef.current;
    if (!el) return;

    let cancelled = false;

    void (async () => {
      try {
        const mod = await import('@/features/chat/attachment-preview-renderer');
        if (cancelled) return;
        const chat = messages(language).chat;
        if (previewKind === 'pdf') {
          const { cleanup } = await mod.renderPdfInContainer(el, binaryBuffer, {
            loadingText: chat.attachmentPreviewPdfRendering,
            loadMoreHint: chat.attachmentPreviewPdfLoadMore,
          });
          binaryCleanupRef.current = cleanup;
        } else if (previewKind === 'excel') {
          const { cleanup, truncated } = await mod.renderExcelInContainer(el, binaryBuffer, {
            truncationNotice: fillTemplate(chat.attachmentPreviewExcelTruncated, {
              rows: EXCEL_PREVIEW_MAX_ROWS,
              cols: EXCEL_PREVIEW_MAX_COLS,
            }),
          });
          binaryCleanupRef.current = cleanup;
          if (!cancelled) setExcelTruncated(truncated);
        } else if (previewKind === 'docx') {
          const { cleanup } = await mod.renderDocxInContainer(el, binaryBuffer);
          binaryCleanupRef.current = cleanup;
        }
      } catch (e) {
        if (!cancelled) {
          setBinaryRenderError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      binaryCleanupRef.current?.();
      binaryCleanupRef.current = null;
    };
  }, [binaryBuffer, previewKind, filePath, language]);

  const handleMarkdownSave = useCallback(
    async (newContent: string) => {
      if (!filePath) return;
      if (saveStatusClearRef.current !== undefined) {
        clearTimeout(saveStatusClearRef.current);
        saveStatusClearRef.current = undefined;
      }
      setSaveStatus('saving');
      try {
        const { mtimeMs: writtenMtime } = await writeWorkspaceFile(
          filePath,
          newContent,
          agentId?.trim() ? { agentId: agentId.trim() } : undefined,
        );
        if (typeof writtenMtime === 'number' && Number.isFinite(writtenMtime)) {
          setMtimeMs(writtenMtime);
        }
        setSaveStatus('saved');
        saveStatusClearRef.current = setTimeout(() => {
          setSaveStatus('idle');
          saveStatusClearRef.current = undefined;
        }, 2000);
      } catch {
        setSaveStatus('idle');
      }
    },
    [filePath, agentId],
  );

  const debouncedHtmlSave = useDebouncedCallback((value: string) => {
    void handleMarkdownSave(value);
  }, 500);

  const handleHtmlChange = useCallback(
    (value: string) => {
      setTextContent(value);
      debouncedHtmlSave(value);
    },
    [debouncedHtmlSave],
  );

  const ext = filePath ? getFileExtension(filePath) : '';
  const name = filePath ? getFileName(filePath) : '';
  const isMd = ext === '.md';
  const isHtml = ext === '.html' || ext === '.htm';

  const handleDownload = useCallback(async () => {
    if (!filePath) return;
    if (binaryBuffer) {
      const mime = inferMimeTypeFromFileName(name) ?? 'application/octet-stream';
      downloadBinaryFile(name, binaryBuffer, mime);
      return;
    }
    if (textContent != null) {
      downloadTextFile(name, textContent);
      return;
    }
    try {
      const { contentBase64 } = await readWorkspaceFileBase64(filePath, readOpts);
      const buf = base64ToArrayBuffer(contentBase64);
      const mime = inferMimeTypeFromFileName(name) ?? 'application/octet-stream';
      downloadBinaryFile(name, buf, mime);
    } catch {
      /* ignore */
    }
  }, [binaryBuffer, filePath, name, readOpts, textContent]);

  const handleOpenWithSystemApp = useCallback(async () => {
    const p = hostAbsolutePath;
    if (!p || !window.electronAPI?.shell?.openPath) return;
    await window.electronAPI.shell.openPath(p);
  }, [hostAbsolutePath]);

  const handleCopyPath = useCallback(() => {
    if (!filePath || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(filePath);
  }, [filePath]);

  if (!filePath) {
    return null;
  }

  const showSystemOpen =
    isElectron() && Boolean(hostAbsolutePath) && Boolean(window.electronAPI?.shell?.openPath);

  let body: ReactNode = null;
  if (loading) {
    body = <p className="px-4 py-6 text-sm text-fg-muted">{m.chat.loading}</p>;
  } else if (loadError) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
        <PreviewOpenAlternativesBar
          message={m.workspace.openElsewhereHint}
          downloadLabel={m.chat.attachmentPreviewDownloadFull}
          onDownload={() => void handleDownload()}
          openSystemLabel={m.workspace.openSystemApp}
          onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
          canOpenWithSystemApp={showSystemOpen}
        />
        <p className="text-sm text-red-600 dark:text-red-400">
          {m.workspace.loadError}: {loadError}
        </p>
      </div>
    );
  } else if (previewKind === 'binaryOnly' && binaryBuffer) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
        <PreviewOpenAlternativesBar
          message={m.workspace.cannotPreviewType + ' ' + m.workspace.openElsewhereHint}
          downloadLabel={m.chat.attachmentPreviewDownloadFull}
          onDownload={handleDownload}
          openSystemLabel={m.workspace.openSystemApp}
          onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
          canOpenWithSystemApp={showSystemOpen}
        />
      </div>
    );
  } else if (binaryBuffer && previewKind === 'pptx') {
    if (pptxError) {
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
          <PreviewOpenAlternativesBar
            message={m.workspace.openElsewhereHint}
            downloadLabel={m.chat.attachmentPreviewDownloadFull}
            onDownload={handleDownload}
            openSystemLabel={m.workspace.openSystemApp}
            onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
            canOpenWithSystemApp={showSystemOpen}
          />
          <p className="text-sm text-red-600 dark:text-red-400">
            {m.workspace.loadError}: {pptxError}
          </p>
        </div>
      );
    } else if (pptxPreviewText === null && !pptxError) {
      body = <p className="px-4 py-6 text-sm text-fg-muted">{m.chat.loading}</p>;
    } else {
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pb-2 pt-1 sm:px-4">
          {pptxTruncated ? (
            <PreviewOpenAlternativesBar
              message={m.chat.attachmentPreviewOpenElsewhereTruncated}
              downloadLabel={m.chat.attachmentPreviewDownloadFull}
              onDownload={handleDownload}
              openSystemLabel={m.workspace.openSystemApp}
              onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
              canOpenWithSystemApp={showSystemOpen}
            />
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            <PptxPreviewView
              text={pptxPreviewText ?? ''}
              slideLabel={(n) => fillTemplate(m.chat.attachmentPreviewPptxSlide, { n })}
              emptySlideLabel={m.chat.attachmentPreviewPptxEmptySlide}
            />
          </div>
        </div>
      );
    }
  } else if (binaryBuffer && previewKind === 'pdf') {
    if (binaryRenderError) {
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
          <PreviewOpenAlternativesBar
            message={m.workspace.openElsewhereHint}
            downloadLabel={m.chat.attachmentPreviewDownloadFull}
            onDownload={handleDownload}
            openSystemLabel={m.workspace.openSystemApp}
            onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
            canOpenWithSystemApp={showSystemOpen}
          />
          <p className="text-sm text-red-600 dark:text-red-400">
            {m.workspace.loadError}: {binaryRenderError}
          </p>
        </div>
      );
    } else {
      body = (
        <div
          ref={binaryPreviewRef}
          className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
        />
      );
    }
  } else if (binaryBuffer && previewKind === 'excel') {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pb-2 pt-1 sm:px-4">
        {binaryRenderError ? (
          <div className="flex flex-col gap-2 px-2">
            <PreviewOpenAlternativesBar
              message={m.workspace.openElsewhereHint}
              downloadLabel={m.chat.attachmentPreviewDownloadFull}
              onDownload={handleDownload}
              openSystemLabel={m.workspace.openSystemApp}
              onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
              canOpenWithSystemApp={showSystemOpen}
            />
            <p className="text-sm text-red-600 dark:text-red-400">{binaryRenderError}</p>
          </div>
        ) : (
          <>
            {excelTruncated ? (
              <PreviewOpenAlternativesBar
                message={m.chat.attachmentPreviewOpenElsewhereTruncated}
                downloadLabel={m.chat.attachmentPreviewDownloadFull}
                onDownload={handleDownload}
                openSystemLabel={m.workspace.openSystemApp}
                onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
                canOpenWithSystemApp={showSystemOpen}
              />
            ) : null}
            <div
              ref={binaryPreviewRef}
              className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
            />
          </>
        )}
      </div>
    );
  } else if (binaryBuffer && previewKind === 'docx') {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pb-2 pt-1 sm:px-4">
        {binaryRenderError ? (
          <div className="flex flex-col gap-2 px-2">
            <PreviewOpenAlternativesBar
              message={m.workspace.openElsewhereHint}
              downloadLabel={m.chat.attachmentPreviewDownloadFull}
              onDownload={handleDownload}
              openSystemLabel={m.workspace.openSystemApp}
              onOpenWithSystemApp={() => void handleOpenWithSystemApp()}
              canOpenWithSystemApp={showSystemOpen}
            />
            <p className="text-sm text-red-600 dark:text-red-400">{binaryRenderError}</p>
          </div>
        ) : (
          <div
            ref={binaryPreviewRef}
            className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
          />
        )}
      </div>
    );
  } else if (textContent !== null && previewKind === 'text') {
    if (isMd && markdownEditMode) {
      body = (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MarkdownSplit
            key={filePath}
            initialContent={textContent}
            onSave={handleMarkdownSave}
            isDark={resolvedTheme === 'dark'}
          />
        </div>
      );
    } else if (isMd) {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView content={textContent} />
        </div>
      );
    } else if (isHtml && htmlCodeMode) {
      body = (
        <div className="min-h-0 flex-1 overflow-hidden">
          <HtmlWorkspaceEditor
            key={filePath}
            initialContent={textContent}
            onChange={handleHtmlChange}
            isDark={resolvedTheme === 'dark'}
          />
        </div>
      );
    } else if (isHtml) {
      body = (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-1 sm:px-4">
          <iframe
            title={name}
            className="min-h-0 w-full flex-1 rounded-lg border border-edge-subtle bg-white dark:border-edge dark:bg-[#1e1e1e]"
            srcDoc={textContent}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals"
          />
        </div>
      );
    } else if (ext === '.ts' || ext === '.js') {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView content={wrapInCodeFence(textContent, ext)} />
        </div>
      );
    } else if (ext === '.json') {
      let display = textContent;
      try {
        display = JSON.stringify(JSON.parse(textContent), null, 2);
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
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-fg">{textContent}</pre>
        </div>
      );
    }
  }

  const canDownload =
    !loading && (binaryBuffer != null || textContent != null || loadError != null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel">
      <div className="flex shrink-0 items-start gap-2 border-b border-edge px-4 py-2 dark:border-edge">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-base font-semibold leading-tight tracking-tight text-fg"
            title={name}
          >
            {name}
          </h2>
          {!loading && mtimeMs != null ? (
            <p
              className="mt-0.5 truncate text-xs leading-tight text-fg-muted"
              title={new Date(mtimeMs).toISOString()}
            >
              {m.workspace.lastModified}: {formatWorkspaceFileMtime(mtimeMs, language)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {(isMd || (isHtml && htmlCodeMode)) && saveStatus !== 'idle' ? (
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
          ) : isHtml ? (
            <button
              type="button"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              title={htmlCodeMode ? m.workspace.preview : m.workspace.edit}
              aria-label={htmlCodeMode ? m.workspace.preview : m.workspace.edit}
              onClick={() => setHtmlCodeMode((v) => !v)}
            >
              {htmlCodeMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
              interaction.focusRingPanel,
            )}
            title={m.workspace.copyPath}
            aria-label={m.workspace.copyPath}
            onClick={handleCopyPath}
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            title={m.workspace.download}
            aria-label={m.workspace.download}
            onClick={() => void handleDownload()}
            disabled={!canDownload}
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
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
}
