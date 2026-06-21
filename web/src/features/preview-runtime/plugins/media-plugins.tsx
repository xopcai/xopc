import { useMemo } from 'react';

import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import { useBlobObjectUrl } from '@/features/file-preview/use-blob-object-url';
import { PreviewOpenAlternativesBar } from '@/features/preview/preview-open-alternatives';
import type { PreviewPlugin, PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';
import { messages } from '@/i18n/messages';

export function AudioPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return <MediaPreview props={props} kind="audio" />;
}

export function VideoPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return <MediaPreview props={props} kind="video" />;
}

function MediaPreview({ props, kind }: { props: PreviewRuntimeRenderProps; kind: 'audio' | 'video' }) {
  const blob = useMemo(() => {
    if (!props.binaryBuffer) return null;
    const mime = inferMimeTypeFromFileName(props.descriptor.fileName) ?? props.descriptor.mimeType;
    return new Blob([props.binaryBuffer], { type: mime || `${kind}/*` });
  }, [kind, props.binaryBuffer, props.descriptor.fileName, props.descriptor.mimeType]);
  const url = useBlobObjectUrl(blob);
  if (!url) return null;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-base p-4 dark:bg-surface-hover/20">
      {kind === 'audio' ? (
        <audio src={url} controls className="w-full max-w-2xl" />
      ) : (
        <video src={url} controls playsInline className="max-h-full max-w-full rounded-md bg-black" />
      )}
    </div>
  );
}

export const audioPlugin: PreviewPlugin = {
  id: 'audio',
  readMode: 'binary',
  capabilities: ['download'],
  render: (props) => <AudioPreviewPluginView {...props} />,
};

export const videoPlugin: PreviewPlugin = {
  id: 'video',
  readMode: 'binary',
  capabilities: ['download'],
  render: (props) => <VideoPreviewPluginView {...props} />,
};

export function UnsupportedPreviewPluginView(props: PreviewRuntimeRenderProps) {
  const m = messages(props.language);
  const isWorkspace = props.descriptor.context === 'workspace';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <PreviewOpenAlternativesBar
        message={
          isWorkspace
            ? `${m.workspace.cannotPreviewType} ${m.workspace.openElsewhereHint}`
            : m.chat.attachmentPreviewOpenElsewhereHint
        }
        downloadLabel={m.chat.attachmentPreviewDownloadFull}
        onDownload={props.actions.onDownload}
        openSystemLabel={isWorkspace ? m.workspace.openSystemApp : undefined}
        onOpenWithSystemApp={props.actions.onOpenWithSystemApp}
        canOpenWithSystemApp={props.actions.canOpenWithSystemApp}
        chooseAppLabel={isWorkspace ? m.workspace.chooseApp : undefined}
        onChooseOpenWithApp={props.actions.onChooseOpenWithApp}
        canChooseOpenWithApp={props.actions.canChooseOpenWithApp}
      />
    </div>
  );
}

export const unsupportedPlugin: PreviewPlugin = {
  id: 'unsupported',
  readMode: 'metadata',
  capabilities: ['download'],
  render: (props) => <UnsupportedPreviewPluginView {...props} />,
};
