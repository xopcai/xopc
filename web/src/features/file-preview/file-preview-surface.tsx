import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { electronPreviewViewportClass } from '@/lib/electron-window-chrome';

/** Expanded previews cover the content surface while leaving shell navigation usable. */
export function FilePreviewSurface({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentSurface = expanded ? anchorRef.current?.closest<HTMLElement>('.app-main-surface')
    ?? document.querySelector<HTMLElement>('.app-main-surface') : null;
  const panel = <div data-file-preview-expanded={expanded || undefined} data-browser-occluder={expanded || undefined}
    className={cn('file-preview-surface flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&_.markdown-body_h1]:border-b-0! [&_.markdown-body_h2]:border-b-0!',
      expanded && (contentSurface ? 'absolute inset-0 z-[115]' : 'fixed inset-0 z-[115] h-[100dvh] w-screen'),
      expanded && !contentSurface && electronPreviewViewportClass())}>
    {children}
  </div>;
  return <><span ref={anchorRef} hidden aria-hidden />{expanded ? createPortal(panel, contentSurface ?? document.body) : panel}</>;
}
