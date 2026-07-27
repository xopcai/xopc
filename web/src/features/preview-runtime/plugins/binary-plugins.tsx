import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PptxPreviewView } from '@/features/preview/pptx-preview-view';
import { PreviewOpenAlternativesBar } from '@/features/preview/preview-open-alternatives';
import {
  EXCEL_PREVIEW_MAX_COLS,
  EXCEL_PREVIEW_MAX_ROWS,
  inferMimeTypeFromFileName,
  PPTX_PREVIEW_MAX_CHARS,
} from '@/features/chat/attachments/attachment-utils-core';
import { useBinaryPreviewInContainer } from '@/features/file-preview/use-binary-preview-in-container';
import { useBlobObjectUrl } from '@/features/file-preview/use-blob-object-url';
import { messages } from '@/i18n/messages';
import type { PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';

function AlternativesBar({ props, message }: { props: PreviewRuntimeRenderProps; message: string }) {
  const m = messages(props.language);
  const isWorkspace = props.descriptor.context === 'workspace';
  const showSystemOpen =
    Boolean(props.actions.onOpenWithSystemApp) && (props.actions.canOpenWithSystemApp ?? true) && isWorkspace;
  return (
    <PreviewOpenAlternativesBar
      message={message}
      downloadLabel={m.chat.attachmentPreviewDownloadFull}
      onDownload={props.actions.onDownload}
      openSystemLabel={isWorkspace ? m.workspace.openSystemApp : undefined}
      onOpenWithSystemApp={props.actions.onOpenWithSystemApp}
      canOpenWithSystemApp={showSystemOpen}
      chooseAppLabel={isWorkspace ? m.workspace.chooseApp : undefined}
      onChooseOpenWithApp={props.actions.onChooseOpenWithApp}
      canChooseOpenWithApp={props.actions.canChooseOpenWithApp}
    />
  );
}

function openElsewhereMessage(props: PreviewRuntimeRenderProps): string {
  const m = messages(props.language);
  return props.descriptor.context === 'workspace'
    ? m.workspace.openElsewhereHint
    : m.chat.attachmentPreviewOpenElsewhereHint;
}

export function InteractiveImagePreview(props: PreviewRuntimeRenderProps) {
  const imageBlob = useMemo(() => {
    if (!props.binaryBuffer) return null;
    const mime = inferMimeTypeFromFileName(props.descriptor.fileName) ?? props.descriptor.mimeType ?? 'image/png';
    return new Blob([props.binaryBuffer], { type: mime });
  }, [props.binaryBuffer, props.descriptor.fileName, props.descriptor.mimeType]);
  const imageObjectUrl = useBlobObjectUrl(imageBlob);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoom = props.controls?.zoom ?? 1;
  const rotation = props.controls?.rotation ?? 0;

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [props.descriptor.id, rotation]);

  if (!imageObjectUrl) return null;

  return (
    <div
      ref={stageRef}
      className="flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden bg-surface-base px-3 py-4 dark:bg-surface-hover/20"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        setOffset({ x: drag.ox + e.clientX - drag.x, y: drag.oy + e.clientY - drag.y });
      }}
      onPointerUp={(e) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
      }}
      onPointerCancel={(e) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
      }}
    >
      <img
        src={imageObjectUrl}
        alt=""
        draggable={false}
        className="max-h-full max-w-full select-none object-contain transition-transform duration-100"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
          cursor: zoom > 1 ? 'grab' : 'default',
        }}
      />
    </div>
  );
}

export function PdfPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return <BinaryContainerPlugin {...props} kind="pdf" />;
}

export function DocxPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return <BinaryContainerPlugin {...props} kind="docx" />;
}

export function SpreadsheetPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return <BinaryContainerPlugin {...props} kind="excel" />;
}

function BinaryContainerPlugin(props: PreviewRuntimeRenderProps & { kind: 'pdf' | 'docx' | 'excel' }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const setPreviewHost = useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    setContainerEl(node);
  }, []);
  const { error, excelTruncated } = useBinaryPreviewInContainer({
    language: props.language,
    buffer: props.binaryBuffer,
    kind: props.kind,
    fileKey: props.descriptor.id,
    containerEl,
    onPdfPageCount: props.kind === 'pdf' ? props.controls?.setPageCount : undefined,
  });
  const m = messages(props.language);
  const zoom = props.kind === 'pdf' ? (props.controls?.zoom ?? 1) : 1;
  const rotation = props.kind === 'pdf' ? (props.controls?.rotation ?? 0) : 0;
  const page = props.kind === 'pdf' ? (props.controls?.page ?? 1) : 1;

  useEffect(() => {
    if (props.kind !== 'pdf' || !ref.current) return;
    ref.current.style.setProperty('--xopc-preview-pdf-zoom', String(zoom));
    ref.current.style.setProperty('--xopc-preview-pdf-rotation', `${rotation}deg`);
    ref.current.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((el) => {
      const baseHeight =
        el.dataset.pdfBaseHeight ?? (el.offsetHeight > 0 ? String(el.offsetHeight) : undefined);
      if (baseHeight) {
        el.dataset.pdfBaseHeight = baseHeight;
        el.style.height = `${Number(baseHeight) * zoom}px`;
      }
      el.style.transformOrigin = 'top center';
      el.style.transform = `scale(${zoom}) rotate(${rotation}deg)`;
      el.style.marginBottom = zoom === 1 ? '' : `${Math.max(16, 24 * zoom)}px`;
    });
  }, [props.kind, rotation, zoom]);

  useEffect(() => {
    if (props.kind !== 'pdf' || !ref.current) return;
    ref.current.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`)?.scrollIntoView({ block: 'start' });
  }, [page, props.kind]);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <AlternativesBar props={props} message={openElsewhereMessage(props)} />
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (props.kind === 'excel') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pb-2 pt-1 sm:px-4">
        {excelTruncated ? (
          <AlternativesBar
            props={props}
            message={m.chat.attachmentPreviewExcelTruncated
              .replaceAll('{rows}', String(EXCEL_PREVIEW_MAX_ROWS))
              .replaceAll('{cols}', String(EXCEL_PREVIEW_MAX_COLS))}
          />
        ) : null}
        <div
          ref={setPreviewHost}
          className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
        />
      </div>
    );
  }

  return (
    <div
      ref={setPreviewHost}
      className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
    />
  );
}

export function PptxPreviewPluginView(props: PreviewRuntimeRenderProps) {
    const m = messages(props.language);
    const raw = props.extractedText || m.chat.attachmentPreviewNoText;
    const truncated = Boolean(props.extractedTextTruncated) || raw.length > PPTX_PREVIEW_MAX_CHARS;
    const text = raw.length > PPTX_PREVIEW_MAX_CHARS ? raw.slice(0, PPTX_PREVIEW_MAX_CHARS) : raw;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pb-2 pt-1 sm:px-4">
        {truncated ? (
          <AlternativesBar props={props} message={m.chat.attachmentPreviewOpenElsewhereTruncated} />
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {truncated ? (
            <p className="mb-2 border-b border-edge-subtle pb-2 text-xs text-fg-muted dark:border-edge">
              {m.chat.attachmentPreviewPptxTruncated}
            </p>
          ) : null}
          <PptxPreviewView
            text={text}
            slideLabel={(n) => m.chat.attachmentPreviewPptxSlide.replaceAll('{n}', String(n))}
            emptySlideLabel={m.chat.attachmentPreviewPptxEmptySlide}
          />
        </div>
      </div>
    );
}
