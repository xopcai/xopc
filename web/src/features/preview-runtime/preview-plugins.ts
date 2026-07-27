import { createElement, lazy, Suspense, type ReactNode } from 'react';

import {
  CodePreviewPluginView,
  HtmlPreviewPluginView,
  MarkdownPreviewPluginView,
  TextPreviewPluginView,
} from '@/features/preview-runtime/plugins/textual-plugins';
import type { PreviewFileType, PreviewPlugin, PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';

function loadingPreview() {
  return createElement(
    'div',
    { className: 'px-4 py-6 text-sm text-fg-muted' },
    'Loading preview...',
  );
}

function lazyPlugin(
  id: PreviewFileType,
  capabilities: PreviewPlugin['capabilities'],
  load: () => Promise<{ default: (props: PreviewRuntimeRenderProps) => ReactNode }>,
  readMode: PreviewPlugin['readMode'] = 'binary',
): PreviewPlugin {
  const Component = lazy(load);
  return {
    id,
    readMode,
    capabilities,
    render: (props) =>
      createElement(
        Suspense,
        { fallback: loadingPreview() },
        createElement(Component, props),
      ),
  };
}

const PLUGINS: Record<PreviewFileType, PreviewPlugin> = {
  text: {
    id: 'text',
    readMode: 'text',
    capabilities: ['download'],
    render: (props) => createElement(TextPreviewPluginView, props),
  },
  markdown: {
    id: 'markdown',
    readMode: 'text',
    capabilities: ['download', 'edit'],
    render: (props) => createElement(MarkdownPreviewPluginView, props),
  },
  code: {
    id: 'code',
    readMode: 'text',
    capabilities: ['download'],
    render: (props) => createElement(CodePreviewPluginView, props),
  },
  html: {
    id: 'html',
    readMode: 'text',
    capabilities: ['download', 'edit'],
    render: (props) => createElement(HtmlPreviewPluginView, props),
  },
  image: lazyPlugin('image', ['download', 'zoom', 'rotate'], () =>
    import('@/features/preview-runtime/plugins/binary-plugins').then((m) => ({ default: m.InteractiveImagePreview })),
  ),
  pdf: lazyPlugin('pdf', ['download', 'zoom', 'rotate', 'pageNavigation', 'print'], () =>
    import('@/features/preview-runtime/plugins/binary-plugins').then((m) => ({ default: m.PdfPreviewPluginView })),
  ),
  docx: lazyPlugin('docx', ['download'], () =>
    import('@/features/preview-runtime/plugins/binary-plugins').then((m) => ({ default: m.DocxPreviewPluginView })),
  ),
  spreadsheet: lazyPlugin('spreadsheet', ['download'], () =>
    import('@/features/preview-runtime/plugins/binary-plugins').then((m) => ({ default: m.SpreadsheetPreviewPluginView })),
  ),
  pptx: lazyPlugin('pptx', ['download'], () =>
    import('@/features/preview-runtime/plugins/binary-plugins').then((m) => ({ default: m.PptxPreviewPluginView })),
  ),
  audio: lazyPlugin('audio', ['download'], () =>
    import('@/features/preview-runtime/plugins/media-plugins').then((m) => ({ default: m.AudioPreviewPluginView })),
  ),
  video: lazyPlugin('video', ['download'], () =>
    import('@/features/preview-runtime/plugins/media-plugins').then((m) => ({ default: m.VideoPreviewPluginView })),
  ),
  archive: lazyPlugin('archive', ['download'], () =>
    import('@/features/preview-runtime/plugins/archive-plugin').then((m) => ({ default: m.ArchivePreviewPluginView })),
  ),
  unsupported: lazyPlugin(
    'unsupported',
    ['download'],
    () =>
      import('@/features/preview-runtime/plugins/media-plugins').then((m) => ({
        default: m.UnsupportedPreviewPluginView,
      })),
    'metadata',
  ),
};

export function selectPreviewPlugin(type: PreviewFileType): PreviewPlugin {
  return PLUGINS[type] ?? PLUGINS.unsupported;
}
