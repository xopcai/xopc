import * as Dialog from '@radix-ui/react-dialog';
import { Download, FileImage, Maximize2, Minus, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import {
  downloadMermaidPng,
  downloadMermaidSvg,
  type MermaidSnapshot,
} from './mermaid-export';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export type MermaidPreviewLabels = {
  title: string;
  close: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  downloadPng: string;
  downloadSvg: string;
  downloadFailed: string;
};

export type MermaidPreviewState = {
  snapshot: MermaidSnapshot;
  baseName: string;
};

export function MermaidPreviewDialog({
  preview,
  labels,
  onClose,
}: {
  preview: MermaidPreviewState | null;
  labels: MermaidPreviewLabels;
  onClose: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [fitting, setFitting] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const updateFitZoom = useCallback(() => {
    const viewport = viewportRef.current;
    const snapshot = preview?.snapshot;
    if (!viewport || !snapshot) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 48);
    const availableHeight = Math.max(1, viewport.clientHeight - 48);
    setFitZoom(Math.min(1, availableWidth / snapshot.width, availableHeight / snapshot.height));
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    setZoom(1);
    setFitting(true);
    setDownloadFailed(false);
    const frame = requestAnimationFrame(updateFitZoom);
    const viewport = viewportRef.current;
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateFitZoom);
    if (viewport) observer?.observe(viewport);
    window.addEventListener('resize', updateFitZoom);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', updateFitZoom);
    };
  }, [preview, updateFitZoom]);

  const changeZoom = (delta: number) => {
    const current = fitting ? fitZoom : zoom;
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta)));
    setFitting(false);
  };

  const handleDownloadPng = async () => {
    if (!preview || downloading) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      await downloadMermaidPng(preview.snapshot, `${preview.baseName}.png`);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  const activeZoom = fitting ? fitZoom : zoom;
  const snapshot = preview?.snapshot;

  return (
    <Dialog.Root open={preview !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-scrim/90 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[91] flex h-[min(92dvh,64rem)] w-[min(96vw,96rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float outline-none"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
              {labels.title}
            </Dialog.Title>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="mermaid-preview-toolbar-button"
                onClick={() => changeZoom(-ZOOM_STEP)}
                title={labels.zoomOut}
                aria-label={labels.zoomOut}
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <span className="mermaid-preview-secondary-action w-12 text-center text-xs tabular-nums text-fg-muted">
                {Math.round(activeZoom * 100)}%
              </span>
              <button
                type="button"
                className="mermaid-preview-toolbar-button"
                onClick={() => changeZoom(ZOOM_STEP)}
                title={labels.zoomIn}
                aria-label={labels.zoomIn}
              >
                <Plus className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={cn('mermaid-preview-toolbar-button', fitting && 'bg-surface-hover text-fg')}
                onClick={() => setFitting(true)}
                title={labels.fit}
                aria-label={labels.fit}
              >
                <Maximize2 className="size-4" aria-hidden />
              </button>
              <span className="mermaid-preview-secondary-action mx-1 h-5 w-px bg-edge" aria-hidden />
              <button
                type="button"
                className="mermaid-preview-toolbar-button"
                onClick={() => void handleDownloadPng()}
                disabled={downloading}
                title={downloadFailed ? labels.downloadFailed : labels.downloadPng}
                aria-label={downloadFailed ? labels.downloadFailed : labels.downloadPng}
                aria-busy={downloading}
              >
                <Download className={cn('size-4', downloading && 'animate-bounce')} aria-hidden />
              </button>
              <button
                type="button"
                className="mermaid-preview-toolbar-button mermaid-preview-secondary-action"
                onClick={() => {
                  if (preview) downloadMermaidSvg(preview.snapshot, `${preview.baseName}.svg`);
                }}
                title={labels.downloadSvg}
                aria-label={labels.downloadSvg}
              >
                <FileImage className="size-4" aria-hidden />
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="mermaid-preview-toolbar-button ml-1"
                  title={labels.close}
                  aria-label={labels.close}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div
            ref={viewportRef}
            className="min-h-0 flex-1 overflow-auto bg-surface-base"
          >
            {snapshot ? (
              <div className="min-h-full min-w-full p-6">
                <div
                  className="m-auto select-none overflow-hidden rounded-lg border border-edge bg-surface-hover shadow-sm [&>svg]:block [&>svg]:size-full [&>svg]:max-w-none"
                  style={{
                    width: `${snapshot.width * activeZoom}px`,
                    height: `${snapshot.height * activeZoom}px`,
                  }}
                  // The snapshot is cloned from the already-sanitized Mermaid DOM and pruned again before serialization.
                  dangerouslySetInnerHTML={{ __html: snapshot.svg }}
                />
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
