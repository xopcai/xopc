import { useEffect, useState } from 'react';
import type { SpaceVersion } from '@xopcai/gateway-contract';

import { detectPreviewFileType, type PreviewFileDescriptor, type PreviewLoadedSource } from '@/features/preview-runtime';
import { PreviewRuntimeToolbar, PreviewRuntimeView, usePreviewRuntimeController } from '@/features/preview-runtime/preview-runtime';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

import { spaceContent, spaceContentUrl } from './space-api';

export function SpacePreview({ itemId, version, hit, download }: {
  itemId: string;
  version: SpaceVersion;
  hit?: { text: string; locator: Record<string, unknown> };
  download: () => Promise<void>;
}) {
  const language = useLocaleStore(state => state.language);
  const resolvedTheme = useThemeStore(state => state.resolved);
  const detected = detectPreviewFileType(version.fileName, version.mimeType);
  const media = detected === 'audio' || detected === 'video';
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const descriptor: PreviewFileDescriptor = {
    id: `space:${version.id}`, context: 'attachment', source: { kind: 'inline' },
    fileName: version.fileName, mimeType: version.mimeType, size: version.sizeBytes,
    type: detected === 'html' ? 'text' : detected,
  };
  const controller = usePreviewRuntimeController(descriptor);
  const [loaded, setLoaded] = useState<Omit<PreviewLoadedSource, 'descriptor'>>({
    loading: true, textContent: null, binaryBuffer: null, loadError: null,
  });
  const { plugin, controls } = controller;
  const { setPage, pageCount } = controls;
  const targetPage = typeof hit?.locator.page === 'number' ? hit.locator.page : undefined;
  const targetSlide = typeof hit?.locator.slide === 'number' ? hit.locator.slide : undefined;
  const targetLine = typeof hit?.locator.line === 'number' ? hit.locator.line : undefined;
  const targetSheet = typeof hit?.locator.sheet === 'string' ? hit.locator.sheet : undefined;
  const targetParagraph = typeof hit?.locator.paragraph === 'number' ? hit.locator.paragraph : undefined;
  useEffect(() => {
    if (targetPage && pageCount !== null) setPage(targetPage);
  }, [targetPage, pageCount, setPage]);
  useEffect(() => {
    const request = new AbortController();
    let url: string | undefined;
    if (media) return;
    if (plugin.readMode === 'metadata') {
      setLoaded({ loading: false, textContent: null, binaryBuffer: null, loadError: null });
      return;
    }
    if (plugin.maxBytes && version.sizeBytes > plugin.maxBytes) {
      setLoaded({ loading: false, textContent: null, binaryBuffer: null, loadError: language === 'zh' ? '文件过大，可下载查看' : 'File too large to preview' });
      return;
    }
    void spaceContent(itemId, version.id, request.signal).then(async blob => {
      const textContent = plugin.readMode === 'text' ? await blob.text() : null;
      const binaryBuffer = plugin.readMode === 'binary' ? await blob.arrayBuffer() : null;
      const presentation = detected === 'pptx' && binaryBuffer
        ? await import('@/features/chat/attachments/attachment-process-heavy').then(module => module.processPptx(binaryBuffer, version.fileName))
        : undefined;
      if (request.signal.aborted) return;
      if (presentation) setExtractedText(presentation.extractedText);
      url = plugin.readMode === 'url' ? URL.createObjectURL(new Blob([blob], { type: version.mimeType })) : undefined;
      setLoaded({ loading: false, textContent, binaryBuffer, rawUrl: url, loadError: null });
    }).catch(() => {
      if (request.signal.aborted) return;
      setLoaded({ loading: false, textContent: null, binaryBuffer: null, loadError: language === 'zh' ? '资料暂不可读' : 'Content unavailable' });
    });
    return () => {
      request.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [detected, media, itemId, version.id, version.fileName, version.mimeType, version.sizeBytes, plugin, language]);
  if (media) {
    const url = spaceContentUrl(itemId, version.id);
    return <div className="flex min-h-48 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel p-3">
      {detected === 'audio' ? <audio src={url} controls preload="metadata" className="w-full" />
        : <video src={url} controls playsInline preload="metadata" className="max-h-full max-w-full rounded-lg" />}
    </div>;
  }
  return (
    <div className="flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel">
      {plugin.capabilities.some(capability => ['zoom', 'pageNavigation', 'rotate', 'search'].includes(capability)) ? (
        <div className="border-b border-edge-subtle px-2 py-1"><PreviewRuntimeToolbar controller={controller} /></div>
      ) : null}
      <PreviewRuntimeView {...loaded} descriptor={descriptor} language={language} resolvedTheme={resolvedTheme}
        targetLine={targetLine} targetSlide={targetSlide} targetSheet={targetSheet} targetParagraph={targetParagraph} extractedText={extractedText} controller={controller} actions={{ onDownload: download, canDownload: true }} />
    </div>
  );
}
