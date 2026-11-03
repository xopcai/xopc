import * as Dialog from '@radix-ui/react-dialog';
import { Download, Maximize, Minus, Plus, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type LightboxImage = {
  src: string;
  alt?: string;
};

type ImageLightboxContextValue = {
  openImage: (src: string, alt?: string) => void;
};

const ImageLightboxContext = createContext<ImageLightboxContextValue | null>(null);

export function useImageLightbox(): ImageLightboxContextValue {
  const ctx = useContext(ImageLightboxContext);
  if (!ctx) {
    return { openImage: () => {} };
  }
  return ctx;
}

export type ImageLightboxProviderProps = {
  children: ReactNode;
  closeLabel?: string;
  interactive?: boolean;
};

export function ImageLightboxProvider({ children, closeLabel = 'Close', interactive = false }: ImageLightboxProviderProps) {
  const labels = messages(useLocaleStore(s => s.language)).chat;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const generation = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const [image, setImage] = useState<LightboxImage | null>(null);

  const openImage = useCallback((src: string, alt?: string) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    generation.current++;
    drag.current = null;
    setZoom(1); setOffset({ x: 0, y: 0 }); setDownloadFailed(false); setDownloading(false);
    setImage({ src, alt });
  }, []);

  const value = useMemo(() => ({ openImage }), [openImage]);

  return (
    <ImageLightboxContext.Provider value={value}>
      {children}
      <Dialog.Root open={image !== null} onOpenChange={(open) => { if (!open) { generation.current++; setImage(null); } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim/90 backdrop-blur-sm" />
          <Dialog.Content
            className={cn(
              'fixed inset-0 z-[71] flex items-center justify-center p-4 outline-none',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
            )}
            aria-describedby={undefined}
            onCloseAutoFocus={event => {
              if (!interactive) return;
              event.preventDefault();
              if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
            }}
          >
            <Dialog.Title className="sr-only">{image?.alt || labels.attachmentPreviewImage}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="absolute right-4 top-4 z-10 rounded-lg bg-surface-panel/80 p-2 text-fg-muted backdrop-blur transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
            {image && interactive ? <>
              <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-lg border border-edge bg-surface-panel p-1 text-fg shadow-surface">
                <button type="button" aria-label={labels.mermaidZoomOut} disabled={zoom <= 1} className="size-11 rounded-md p-3 hover:bg-surface-hover disabled:opacity-40" onClick={() => { setZoom(n => Math.max(1, n - 0.5)); setOffset({ x: 0, y: 0 }); }}><Minus className="size-5" /></button>
                <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
                <button type="button" aria-label={labels.mermaidZoomIn} disabled={zoom >= 4} className="size-11 rounded-md p-3 hover:bg-surface-hover disabled:opacity-40" onClick={() => setZoom(n => Math.min(4, n + 0.5))}><Plus className="size-5" /></button>
                <button type="button" aria-label={labels.mermaidFit} className="size-11 rounded-md p-3 hover:bg-surface-hover" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><Maximize className="size-5" /></button>
                <button type="button" aria-label={labels.attachmentPreviewDownload} disabled={downloading} className="size-11 rounded-md p-3 hover:bg-surface-hover disabled:opacity-40" onClick={async () => {
                  const request = generation.current;
                  setDownloading(true); setDownloadFailed(false);
                  try {
                    const response = await fetch(image.src);
                    if (!response.ok) throw new Error('Download failed');
                    const blob = await response.blob();
                    if (request !== generation.current) return;
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
                    anchor.download = `image.${/^[a-z0-9]+$/i.test(extension ?? '') ? extension : 'png'}`;
                    document.body.append(anchor); anchor.click(); anchor.remove();
                    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                  } catch { if (request === generation.current) setDownloadFailed(true); }
                  finally { if (request === generation.current) setDownloading(false); }
                }}><Download className="size-5" /></button>
              </div>
              {downloadFailed && <p role="alert" className="absolute bottom-20 rounded-md bg-surface-panel px-3 py-2 text-sm text-danger">{labels.imageDownloadFailed}</p>}
            </> : null}
            {image ? <div className={interactive ? 'flex h-full w-full touch-none items-center justify-center overflow-hidden pb-16' : 'contents'}
              onPointerDown={event => {
                if (!interactive || zoom <= 1 || event.button !== 0 || !event.isPrimary) return;
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={event => {
                const start = drag.current;
                if (start?.id === event.pointerId) setOffset({ x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y });
              }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
              <img src={image.src} alt={image.alt ?? ''} draggable={false}
                className={interactive ? 'max-h-[min(80vh,900px)] max-w-[min(95vw,1200px)] select-none rounded-lg object-contain' : 'max-h-[min(90vh,900px)] max-w-[min(95vw,1200px)] rounded-lg object-contain shadow-lg'}
                style={interactive ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : undefined } : undefined} />
            </div> : null}

          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ImageLightboxContext.Provider>
  );
}
