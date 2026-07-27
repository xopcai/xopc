import { ImageOff } from 'lucide-react';
import { useEffect, useMemo, useState, type ImgHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

import { parseNoteAttachmentTarget } from './attachment-ref';
import { acquireNoteMediaObjectUrl, releaseNoteMediaObjectUrl } from './note-media-blob';

export type AuthenticatedImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError' | 'onClick'
> & {
  /** Stored markdown src (`xopc-attachment://…`). */
  src: string;
  expectedNoteId?: string;
  onClick?: (displaySrc: string) => void;
  onLoadFailed?: () => void;
};

export function AuthenticatedImage({
  src,
  expectedNoteId,
  alt = '',
  className,
  onClick,
  onLoadFailed,
  ...rest
}: AuthenticatedImageProps) {
  const parsed = useMemo(
    () => parseNoteAttachmentTarget(src, expectedNoteId),
    [src, expectedNoteId],
  );
  const [displaySrc, setDisplaySrc] = useState<string | null>(parsed ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!parsed) {
      setDisplaySrc(src);
      return;
    }

    let cancelled = false;
    setDisplaySrc(null);

    void acquireNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId)
      .then((url) => {
        if (!cancelled) setDisplaySrc(url);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          onLoadFailed?.();
        }
      });

    return () => {
      cancelled = true;
      releaseNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId);
    };
  }, [src, parsed, onLoadFailed]);

  if (failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-surface-hover text-fg-muted',
          className,
        )}
        aria-hidden={!alt}
      >
        <ImageOff className="size-5" />
      </div>
    );
  }

  if (!displaySrc) {
    return (
      <div
        className={cn('animate-pulse bg-surface-hover', className)}
        aria-hidden={!alt}
      />
    );
  }

  return (
    <img
      {...rest}
      src={displaySrc}
      alt={alt}
      className={className}
      onClick={onClick ? () => onClick(displaySrc) : undefined}
      onError={() => {
        setFailed(true);
        onLoadFailed?.();
      }}
    />
  );
}
