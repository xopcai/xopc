import { Minus, Plus, RotateCw, Search, StepBack, StepForward } from 'lucide-react';
import { type ReactNode } from 'react';

import type { PreviewPlugin, PreviewRuntimeControls } from '@/features/preview-runtime/preview-types';
import { cn } from '@/lib/cn';

type PreviewToolbarProps = {
  plugin: PreviewPlugin;
  controls: PreviewRuntimeControls;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onRotate: () => void;
  onSearchChange: (value: string) => void;
};

export function PreviewToolbar({
  plugin,
  controls,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onRotate,
  onSearchChange,
}: PreviewToolbarProps) {
  const canZoom = plugin.capabilities.includes('zoom');
  const canSearch = plugin.capabilities.includes('search');
  const canRotate = plugin.capabilities.includes('rotate');
  const canPage = plugin.capabilities.includes('pageNavigation') && controls.pageCount != null && controls.pageCount > 1;
  const show = canZoom || canSearch || canRotate || canPage;
  if (!show) return null;

  const units: ReactNode[] = [];
  if (canPage) {
    units.push(
      <div key="page" className="flex items-center gap-1 rounded-md border border-edge-subtle bg-surface-base p-0.5 dark:border-edge">
          <ToolbarButton
            label="Previous page"
            disabled={controls.page <= 1}
            onClick={() => controls.setPage(Math.max(1, controls.page - 1))}
          >
            <StepBack className="size-3.5" />
          </ToolbarButton>
          <span className="min-w-16 px-1 text-center text-xs text-fg-muted">
            {controls.page} / {controls.pageCount}
          </span>
          <ToolbarButton
            label="Next page"
            disabled={controls.page >= (controls.pageCount ?? 1)}
            onClick={() => controls.setPage(Math.min(controls.pageCount ?? controls.page, controls.page + 1))}
          >
            <StepForward className="size-3.5" />
          </ToolbarButton>
      </div>,
    );
  }
  if (canZoom) {
    units.push(
      <div key="zoom" className="flex items-center gap-1 rounded-md border border-edge-subtle bg-surface-base p-0.5 dark:border-edge">
          <ToolbarButton label="Zoom out" onClick={onZoomOut}>
            <Minus className="size-3.5" />
          </ToolbarButton>
          <button
            type="button"
            className="min-w-14 rounded px-1.5 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
            onClick={onZoomReset}
            title="Reset zoom"
          >
            {Math.round(controls.zoom * 100)}%
          </button>
          <ToolbarButton label="Zoom in" onClick={onZoomIn}>
            <Plus className="size-3.5" />
          </ToolbarButton>
      </div>,
    );
  }
  if (canRotate) {
    units.push(
        <ToolbarButton key="rotate" label="Rotate" onClick={onRotate}>
          <RotateCw className="size-3.5" />
        </ToolbarButton>,
    );
  }
  if (canSearch) {
    units.push(
      <label key="search" className="flex min-w-40 items-center gap-1 rounded-md border border-edge-subtle bg-surface-base px-2 py-1 text-xs text-fg-muted dark:border-edge">
          <Search className="size-3.5" aria-hidden />
          <input
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
            value={controls.searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
          />
      </label>,
    );
  }
  return <div className="flex shrink-0 items-center gap-1">{units}</div>;
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40',
      )}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
