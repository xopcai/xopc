import { useEffect, useRef, useState, type ComponentProps } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useImageLightbox } from '@/components/ui/image-lightbox';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type Props = Omit<ComponentProps<'img'>, 'src' | 'onClick'> & {
  source: string;
  load?: () => Promise<Blob>;
  onOpen?: () => void;
};

/** A bounded reading preview; full resolution stays available in the viewer. */
export function ChatImageThumbnail({ source, load, onOpen, alt = '', className, ...props }: Props) {
  const labels = messages(useLocaleStore(s => s.language)).chat;
  const { openImage } = useImageLightbox();
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<{ source: string; url: string; attempt: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ source: string; width: number; height: number } | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!load) return;
    let active = true;
    let url: string | undefined;
    void load().then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setResolved({ source, url, attempt });
    }).catch(() => { if (active) setFailed(source); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [source, load, attempt]);
  const src = load ? resolved?.source === source && resolved.attempt === attempt ? resolved.url : undefined : source;
  const error = failed === source;
  const measure = (image: HTMLImageElement) => {
    if (!image.naturalWidth) return;
    setDimensions({ source, width: image.naturalWidth, height: image.naturalHeight });
    setReady(source);
  };
  useEffect(() => {
    if (imageRef.current?.complete) measure(imageRef.current);
  }, [src]);
  const size = dimensions?.source === source ? dimensions : null;
  const scale = size ? Math.min(1, 320 / size.width, 280 / size.height) : 1;
  return <span className="chat-image-thumbnail" data-image-loading={ready !== source && !error || undefined}
    style={size ? { width: size.width * scale, aspectRatio: `${size.width} / ${size.height}` } : undefined}>
    {ready !== source && !error && <Skeleton as="span" className="pointer-events-none absolute inset-0" />}
    {!error && <img {...props} ref={imageRef} key={`${source}:${attempt}`} src={src} alt={alt} loading="lazy" decoding="async"
      data-chat-image-source={source} title={props.title ?? labels.attachmentPreviewImage}
      className={['chat-reading-image', className].filter(Boolean).join(' ')}
      role={src ? 'button' : undefined} tabIndex={src ? 0 : undefined}
      aria-label={src ? `${labels.attachmentPreviewImage}${alt ? `: ${alt}` : ''}` : undefined}
      onLoad={event => measure(event.currentTarget)} onError={() => setFailed(source)}
      onClick={event => {
        if (!src) return;
        event.preventDefault(); event.stopPropagation();
        if (onOpen) onOpen(); else openImage(src, alt);
      }}
      onKeyDown={event => {
        if (!src || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault(); event.stopPropagation();
        if (onOpen) onOpen(); else openImage(src, alt);
      }} />}
    {error && <span className="flex min-h-24 flex-col items-start justify-center gap-2 p-3 text-sm text-fg-muted" role="status">
      <span>{labels.attachmentPreviewLoadError}{alt ? ` · ${alt}` : ''}</span>
      <button type="button" className="min-h-11 rounded-md px-2 text-accent-fg focus-visible:outline-2 focus-visible:outline-accent"
        onClick={event => { event.preventDefault(); event.stopPropagation(); setFailed(null); setReady(null); setAttempt(n => n + 1); }}>{labels.userMessageRetry}</button>
    </span>}
  </span>;
}
