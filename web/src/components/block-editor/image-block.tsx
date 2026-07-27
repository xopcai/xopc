import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { AuthenticatedImage } from '@/features/notes/authenticated-image';
import { useNoteImageLightbox } from '@/features/notes/note-image-lightbox';
import { cn } from '@/lib/cn';

/**
 * Resizable image NodeView for Tiptap.
 * Supports drag-to-resize from the bottom-right corner handle.
 */
export function ImageBlock({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, title } = node.attrs as { src: string; alt?: string; title?: string; width?: number };
  const { openImage } = useNoteImageLightbox();
  const [loadFailed, setLoadFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setResizing(true);
      startXRef.current = event.clientX;
      startWidthRef.current = containerRef.current?.offsetWidth ?? 400;
    },
    [],
  );

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      const diff = event.clientX - startXRef.current;
      const newWidth = Math.max(100, startWidthRef.current + diff);
      updateAttributes({ width: newWidth });
    };

    const handleMouseUp = () => {
      setResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, updateAttributes]);

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  const width = (node.attrs as { width?: number }).width;

  return (
    <NodeViewWrapper className="block-editor-image-wrapper">
      <div
        ref={containerRef}
        className={cn(
          'relative inline-block',
          selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-base rounded-lg',
        )}
        style={{ width: width ? `${width}px` : undefined, maxWidth: '100%' }}
      >
        {loadFailed ? (
          <div className="flex min-h-24 min-w-[12rem] items-center justify-center rounded-lg border border-dashed border-edge bg-surface-hover text-fg-muted">
            <span className="text-xs">Image unavailable</span>
          </div>
        ) : (
          <AuthenticatedImage
            src={src}
            alt={alt ?? ''}
            title={title ?? undefined}
            className="block h-auto w-full cursor-zoom-in rounded-lg"
            draggable={false}
            onClick={(displaySrc) => openImage(displaySrc, alt ?? undefined)}
            onLoadFailed={() => setLoadFailed(true)}
          />
        )}
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'absolute bottom-1 right-1 size-4 cursor-se-resize rounded-sm opacity-0 transition-opacity',
            'bg-accent/70 hover:bg-accent',
            (selected || resizing) && 'opacity-100',
          )}
          title="Drag to resize"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className="m-0.5 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M10 2L2 10M10 6L6 10M10 10L10 10" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
