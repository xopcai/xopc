import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { HtmlWorkspaceEditor } from '@/components/html/html-workspace-editor';
import { MarkdownSplit } from '@/components/markdown/markdown-split';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { inferMimeTypeFromFileName, PPTX_PREVIEW_MAX_CHARS } from '@/features/chat/attachments/attachment-utils-core';
import { PreviewOpenAlternativesBar } from '@/features/preview/preview-open-alternatives';
import { PptxPreviewView } from '@/features/preview/pptx-preview-view';
import { useBinaryPreviewInContainer } from '@/features/file-preview/use-binary-preview-in-container';
import { useBlobObjectUrl } from '@/features/file-preview/use-blob-object-url';
import type { FilePreviewKind } from '@/features/file-preview/types';
import { getFileExtension } from '@/features/file-preview/utils';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

type CommonActions = {
  onDownload: () => void;
  canDownload: boolean;
  onOpenWithSystemApp?: () => void | Promise<void>;
  canOpenWithSystemApp?: boolean;
  onChooseOpenWithApp?: () => void | Promise<void>;
  canChooseOpenWithApp?: boolean;
};

type WorkspaceTextEditing = {
  markdownEditMode: boolean;
  onSaveMarkdown?: (next: string) => void | Promise<void>;
  htmlCodeMode: boolean;
  onHtmlChange?: (next: string) => void;
  isDark?: boolean;
};

export type FilePreviewBodyProps = {
  context: 'workspace' | 'attachment';
  language: StoredLanguage;
  resolvedTheme?: 'light' | 'dark';
  fileKey: string;
  fileName: string;

  loading: boolean;
  loadError: string | null;

  previewKind: FilePreviewKind | null;
  textContent: string | null;
  binaryBuffer: ArrayBuffer | null;

  /** Attachment-only: if true, show extracted text view (not binary renderer). */
  showExtractedText?: boolean;
  /** Attachment-only: extractedText payload (already capped by caller if needed). */
  extractedText?: string | null;
  /** Attachment-only: whether extracted text is truncated. */
  extractedTextTruncated?: boolean;

  /** Workspace-only: markdown/html editors; ignored for attachment. */
  workspaceEditing?: WorkspaceTextEditing;
  /** Workspace-only: optional source line to highlight for path:line links. */
  targetLine?: number | null;

  /** PPTX: already processed text & error. */
  pptxText?: string | null;
  pptxTruncated?: boolean;
  pptxError?: string | null;

  actions: CommonActions;
};

function wrapInCodeFence(content: string, extension: string): string {
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.js': 'javascript',
    '.json': 'json',
  };
  const lang = langMap[extension] ?? 'plaintext';
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

function LineNumberedTextPreview({ text, targetLine }: { text: string; targetLine: number }) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => text.split(/\r\n|\n|\r/), [text]);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: 'center' });
  }, [targetLine, text]);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div className="min-w-max font-mono text-xs leading-relaxed text-fg">
        {lines.map((line, index) => {
          const n = index + 1;
          const active = n === targetLine;
          return (
            <div
              key={n}
              ref={active ? targetRef : undefined}
              className={active ? 'flex bg-accent-soft/60 text-fg' : 'flex'}
              data-line={n}
            >
              <span className="w-12 shrink-0 select-none pr-3 text-right text-fg-subtle">{n}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type PptxSlidePaneLayout = 'attachment' | 'workspace';

/** Shared PPTX “slides from extracted text” layout for attachment vs workspace previews. */
function FilePreviewPptxSlidePane({
  layout,
  text,
  showTruncationBar,
  onDownload,
  downloadLabel,
  truncationMessage,
  truncatedCaption,
  slideLabel,
  emptySlideLabel,
  openSystemLabel,
  onOpenWithSystemApp,
  canOpenWithSystemApp,
  chooseAppLabel,
  onChooseOpenWithApp,
  canChooseOpenWithApp,
}: {
  layout: PptxSlidePaneLayout;
  text: string;
  showTruncationBar: boolean;
  onDownload: () => void;
  downloadLabel: string;
  truncationMessage: string;
  truncatedCaption: string;
  slideLabel: (n: number) => string;
  emptySlideLabel: string;
  openSystemLabel?: string;
  onOpenWithSystemApp?: () => void | Promise<void>;
  canOpenWithSystemApp?: boolean;
  chooseAppLabel?: string;
  onChooseOpenWithApp?: () => void | Promise<void>;
  canChooseOpenWithApp?: boolean;
}) {
  const outerClass =
    layout === 'workspace'
      ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pb-2 pt-1 sm:px-4'
      : 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden';

  const innerScrollClass =
    layout === 'workspace'
      ? 'min-h-0 flex-1 overflow-auto p-2'
      : 'min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle p-4 dark:border-edge';

  return (
    <div className={outerClass}>
      {showTruncationBar ? (
        <PreviewOpenAlternativesBar
          message={truncationMessage}
          downloadLabel={downloadLabel}
          onDownload={onDownload}
          openSystemLabel={openSystemLabel}
          onOpenWithSystemApp={onOpenWithSystemApp}
          canOpenWithSystemApp={canOpenWithSystemApp}
          chooseAppLabel={chooseAppLabel}
          onChooseOpenWithApp={onChooseOpenWithApp}
          canChooseOpenWithApp={canChooseOpenWithApp}
        />
      ) : null}
      <div className={innerScrollClass}>
        {showTruncationBar ? (
          <p className="mb-2 border-b border-edge-subtle pb-2 text-xs text-fg-muted dark:border-edge">
            {truncatedCaption}
          </p>
        ) : null}
        <PptxPreviewView text={text} slideLabel={slideLabel} emptySlideLabel={emptySlideLabel} />
      </div>
    </div>
  );
}

export function FilePreviewBody(props: FilePreviewBodyProps) {
  const {
    context,
    language,
    resolvedTheme,
    fileKey,
    fileName,
    loading,
    loadError,
    previewKind,
    textContent,
    binaryBuffer,
    showExtractedText,
    extractedText,
    extractedTextTruncated,
    workspaceEditing,
    targetLine,
    pptxText,
    pptxTruncated,
    pptxError,
    actions,
  } = props;

  const m = messages(language);
  const ext = useMemo(() => getFileExtension(fileName), [fileName]);
  const isMd = ext === '.md';
  const isHtml = ext === '.html' || ext === '.htm';

  const binaryContainerRef = useRef<HTMLDivElement | null>(null);
  const binaryKind = previewKind === 'pdf' || previewKind === 'excel' || previewKind === 'docx' ? previewKind : null;
  const { error: binaryRenderError, excelTruncated } = useBinaryPreviewInContainer({
    language,
    buffer: binaryBuffer,
    kind: binaryKind,
    fileKey,
    containerEl: binaryContainerRef.current,
  });

  const imageBlob = useMemo(() => {
    if (!binaryBuffer || previewKind !== 'image') return null;
    const mime = inferMimeTypeFromFileName(fileName) ?? 'image/png';
    return new Blob([binaryBuffer], { type: mime });
  }, [binaryBuffer, previewKind, fileName]);
  const imageObjectUrl = useBlobObjectUrl(imageBlob);

  const showSystemOpen =
    Boolean(actions.onOpenWithSystemApp) && (actions.canOpenWithSystemApp ?? true) && context === 'workspace';

  const openElsewhereMessage =
    context === 'workspace' ? m.workspace.openElsewhereHint : m.chat.attachmentPreviewOpenElsewhereHint;

  const downloadLabel = m.chat.attachmentPreviewDownloadFull;

  const openSystemLabel = context === 'workspace' ? m.workspace.openSystemApp : undefined;
  const chooseAppLabel = context === 'workspace' ? m.workspace.chooseApp : undefined;

  const pptxSlideLabel = (n: number) => m.chat.attachmentPreviewPptxSlide.replaceAll('{n}', String(n));

  const baseAlternativesBar = (
    <PreviewOpenAlternativesBar
      message={openElsewhereMessage}
      downloadLabel={downloadLabel}
      onDownload={actions.onDownload}
      openSystemLabel={openSystemLabel}
      onOpenWithSystemApp={actions.onOpenWithSystemApp}
      canOpenWithSystemApp={showSystemOpen}
      chooseAppLabel={chooseAppLabel}
      onChooseOpenWithApp={actions.onChooseOpenWithApp}
      canChooseOpenWithApp={actions.canChooseOpenWithApp}
    />
  );

  let body: ReactNode = null;

  if (loading && previewKind == null) {
    body = <p className="px-4 py-6 text-sm text-fg-muted">{m.chat.loading}</p>;
  } else if (loadError) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {baseAlternativesBar}
        <p className="text-sm text-red-600 dark:text-red-400">
          {(context === 'workspace' ? m.workspace.loadError : m.chat.attachmentPreviewLoadError) + ': ' + loadError}
        </p>
      </div>
    );
  } else if (context === 'attachment' && showExtractedText && previewKind !== 'image') {
    const raw = extractedText || m.chat.attachmentPreviewNoText;
    const capText =
      previewKind === 'pptx' && raw.length > PPTX_PREVIEW_MAX_CHARS ? raw.slice(0, PPTX_PREVIEW_MAX_CHARS) : raw;
    const truncated = Boolean(extractedTextTruncated) || (previewKind === 'pptx' && raw.length > PPTX_PREVIEW_MAX_CHARS);
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {truncated && previewKind === 'pptx' ? (
          <PreviewOpenAlternativesBar
            message={m.chat.attachmentPreviewOpenElsewhereTruncated}
            downloadLabel={m.chat.attachmentPreviewDownloadFull}
            onDownload={actions.onDownload}
          />
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-hover/40 p-4 dark:border-edge">
          {truncated && previewKind === 'pptx' ? (
            <p className="mb-2 border-b border-edge-subtle pb-2 text-xs text-fg-muted dark:border-edge">
              {m.chat.attachmentPreviewPptxTruncated}
            </p>
          ) : null}
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg-muted">
            {capText}
          </pre>
        </div>
      </div>
    );
  } else if (previewKind === 'binaryOnly' && binaryBuffer) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <PreviewOpenAlternativesBar
          message={
            context === 'workspace'
              ? m.workspace.cannotPreviewType + ' ' + m.workspace.openElsewhereHint
              : m.chat.attachmentPreviewOpenElsewhereHint
          }
          downloadLabel={m.chat.attachmentPreviewDownloadFull}
          onDownload={actions.onDownload}
          openSystemLabel={openSystemLabel}
          onOpenWithSystemApp={actions.onOpenWithSystemApp}
          canOpenWithSystemApp={showSystemOpen}
          chooseAppLabel={chooseAppLabel}
          onChooseOpenWithApp={actions.onChooseOpenWithApp}
          canChooseOpenWithApp={actions.canChooseOpenWithApp}
        />
      </div>
    );
  } else if (binaryBuffer && previewKind === 'image' && imageObjectUrl) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-base px-3 py-4 dark:bg-surface-hover/20">
        <img
          src={imageObjectUrl}
          alt=""
          className={
            context === 'workspace' ? 'max-h-[min(100%,calc(100dvh-9rem))] w-auto max-w-full object-contain' : 'max-h-full max-w-full object-contain'
          }
        />
      </div>
    );
  } else if (binaryBuffer && previewKind === 'pptx') {
    if (context === 'attachment') {
      const raw = extractedText || m.chat.attachmentPreviewNoText;
      const cap = PPTX_PREVIEW_MAX_CHARS;
      const truncated = Boolean(extractedTextTruncated) || raw.length > cap;
      const text = raw.length > cap ? raw.slice(0, cap) : raw;
      body = (
        <FilePreviewPptxSlidePane
          layout="attachment"
          text={text}
          showTruncationBar={truncated}
          onDownload={actions.onDownload}
          downloadLabel={downloadLabel}
          truncationMessage={m.chat.attachmentPreviewOpenElsewhereTruncated}
          truncatedCaption={m.chat.attachmentPreviewPptxTruncated}
          slideLabel={pptxSlideLabel}
          emptySlideLabel={m.chat.attachmentPreviewPptxEmptySlide}
        />
      );
    } else if (pptxError) {
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
          {baseAlternativesBar}
          <p className="text-sm text-red-600 dark:text-red-400">
            {(context === 'workspace' ? m.workspace.loadError : m.chat.attachmentPreviewLoadError) + ': ' + pptxError}
          </p>
        </div>
      );
    } else if (pptxText == null) {
      body = <p className="px-4 py-6 text-sm text-fg-muted">{m.chat.loading}</p>;
    } else {
      body = (
        <FilePreviewPptxSlidePane
          layout="workspace"
          text={pptxText}
          showTruncationBar={Boolean(pptxTruncated)}
          onDownload={actions.onDownload}
          downloadLabel={downloadLabel}
          truncationMessage={m.chat.attachmentPreviewOpenElsewhereTruncated}
          truncatedCaption={m.chat.attachmentPreviewPptxTruncated}
          slideLabel={pptxSlideLabel}
          emptySlideLabel={m.chat.attachmentPreviewPptxEmptySlide}
          openSystemLabel={openSystemLabel}
          onOpenWithSystemApp={actions.onOpenWithSystemApp}
          canOpenWithSystemApp={showSystemOpen}
          chooseAppLabel={chooseAppLabel}
          onChooseOpenWithApp={actions.onChooseOpenWithApp}
          canChooseOpenWithApp={actions.canChooseOpenWithApp}
        />
      );
    }
  } else if (binaryBuffer && (previewKind === 'pdf' || previewKind === 'docx')) {
    if (binaryRenderError) {
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
          {baseAlternativesBar}
          <p className="text-sm text-red-600 dark:text-red-400">
            {(context === 'workspace' ? m.workspace.loadError : m.chat.attachmentPreviewLoadError) + ': ' + binaryRenderError}
          </p>
        </div>
      );
    } else {
      body = (
        <div
          ref={binaryContainerRef}
          className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
        />
      );
    }
  } else if (binaryBuffer && previewKind === 'excel') {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pb-2 pt-1 sm:px-4">
        {binaryRenderError ? (
          <div className="flex flex-col gap-2 px-2">
            {baseAlternativesBar}
            <p className="text-sm text-red-600 dark:text-red-400">{binaryRenderError}</p>
          </div>
        ) : (
          <>
            {excelTruncated ? (
              <PreviewOpenAlternativesBar
                message={m.chat.attachmentPreviewOpenElsewhereTruncated}
                downloadLabel={m.chat.attachmentPreviewDownloadFull}
                onDownload={actions.onDownload}
                openSystemLabel={openSystemLabel}
                onOpenWithSystemApp={actions.onOpenWithSystemApp}
                canOpenWithSystemApp={showSystemOpen}
                chooseAppLabel={chooseAppLabel}
                onChooseOpenWithApp={actions.onChooseOpenWithApp}
                canChooseOpenWithApp={actions.canChooseOpenWithApp}
              />
            ) : null}
            <div
              ref={binaryContainerRef}
              className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
            />
          </>
        )}
      </div>
    );
  } else if (textContent !== null && previewKind === 'text') {
    if (context === 'workspace' && targetLine && targetLine > 0) {
      body = <LineNumberedTextPreview text={textContent} targetLine={targetLine} />;
    } else if (context === 'workspace' && isMd && workspaceEditing?.markdownEditMode) {
      body = (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MarkdownSplit
            key={fileKey}
            initialContent={textContent}
            onSave={(c) => void workspaceEditing?.onSaveMarkdown?.(c)}
            isDark={(workspaceEditing?.isDark ?? (resolvedTheme === 'dark')) === true}
          />
        </div>
      );
    } else if (isMd) {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView content={textContent} />
        </div>
      );
    } else if (context === 'workspace' && isHtml && workspaceEditing?.htmlCodeMode) {
      body = (
        <div className="min-h-0 flex-1 overflow-hidden">
          <HtmlWorkspaceEditor
            key={fileKey}
            initialContent={textContent}
            onChange={(v) => workspaceEditing?.onHtmlChange?.(v)}
            isDark={(workspaceEditing?.isDark ?? (resolvedTheme === 'dark')) === true}
          />
        </div>
      );
    } else if (isHtml) {
      body = (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-1 sm:px-4">
          <iframe
            title={fileName}
            className="min-h-0 w-full flex-1 rounded-lg border border-edge-subtle bg-white dark:border-edge dark:bg-[#1e1e1e]"
            srcDoc={textContent}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals"
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

  return <div className="flex min-h-0 flex-1 flex-col">{body}</div>;
}
