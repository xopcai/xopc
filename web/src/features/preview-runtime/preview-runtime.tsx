import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { messages } from '@/i18n/messages';
import { selectPreviewPlugin } from '@/features/preview-runtime/preview-plugins';
import { PreviewToolbar } from '@/features/preview-runtime/preview-toolbar';
import type { PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';

export type PreviewRuntimeController = ReturnType<typeof usePreviewRuntimeController>;

export function usePreviewRuntimeController(descriptor: PreviewRuntimeRenderProps['descriptor']) {
  const plugin = selectPreviewPlugin(descriptor.type);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [page, setPageRaw] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const setPage = useCallback(
    (next: number) => {
      const upper = pageCount ?? next;
      setPageRaw(Math.max(1, Math.min(upper, Math.floor(next))));
    },
    [pageCount],
  );

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPageRaw(1);
    setPageCount(null);
    setSearchQuery('');
  }, [descriptor.id, descriptor.type]);

  const controls = useMemo(
    () => ({ zoom, rotation, page, pageCount, searchQuery, setPageCount, setPage }),
    [page, pageCount, rotation, searchQuery, setPage, zoom],
  );

  return {
    plugin,
    controls,
    onZoomIn: () => setZoom((v) => Math.min(4, Number((v + 0.15).toFixed(2)))),
    onZoomOut: () => setZoom((v) => Math.max(0.25, Number((v - 0.15).toFixed(2)))),
    onZoomReset: () => {
      setZoom(1);
      setRotation(0);
    },
    onRotate: () => setRotation((v) => (v + 90) % 360),
    onSearchChange: setSearchQuery,
  };
}

export function PreviewRuntimeToolbar({
  controller,
  actions,
}: {
  controller: PreviewRuntimeController;
  actions: PreviewRuntimeRenderProps['actions'];
}) {
  return (
    <PreviewToolbar
      plugin={controller.plugin}
      actions={actions}
      controls={controller.controls}
      onZoomIn={controller.onZoomIn}
      onZoomOut={controller.onZoomOut}
      onZoomReset={controller.onZoomReset}
      onRotate={controller.onRotate}
      onSearchChange={controller.onSearchChange}
    />
  );
}

export function PreviewRuntimeView(
  props: PreviewRuntimeRenderProps & {
    controller?: PreviewRuntimeController;
    renderToolbar?: (toolbar: ReactNode) => ReactNode;
  },
) {
  const m = messages(props.language);
  const internalController = usePreviewRuntimeController(props.descriptor);
  const controller = props.controller ?? internalController;
  const toolbar = <PreviewRuntimeToolbar controller={controller} actions={props.actions} />;

  if (props.loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-sm text-fg-muted">
        {m.chat.loading}
      </div>
    );
  }

  if (props.loadError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <p className="text-sm text-red-600 dark:text-red-400">
          {(props.descriptor.context === 'workspace' ? m.workspace.loadError : m.chat.attachmentPreviewLoadError) +
            ': ' +
            props.loadError}
        </p>
      </div>
    );
  }

  if (props.descriptor.context === 'attachment' && props.showExtractedText && props.descriptor.type !== 'image') {
    const raw = props.extractedText || m.chat.attachmentPreviewNoText;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-hover/40 p-4 dark:border-edge">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg-muted">
            {raw}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {props.renderToolbar ? props.renderToolbar(toolbar) : toolbar}
      <PluginRender
        key={`${props.descriptor.id}:${controller.plugin.id}`}
        pluginRender={controller.plugin.render}
        props={{ ...props, controls: controller.controls }}
      />
    </div>
  );
}

function PluginRender({
  pluginRender,
  props,
}: {
  pluginRender: (props: PreviewRuntimeRenderProps) => React.ReactNode;
  props: PreviewRuntimeRenderProps;
}) {
  return <div className="flex min-h-0 flex-1 flex-col">{pluginRender(props)}</div>;
}
