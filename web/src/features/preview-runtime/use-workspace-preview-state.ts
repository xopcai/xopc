import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { inferMimeTypeFromFileName, PPTX_PREVIEW_MAX_CHARS } from '@/features/chat/attachments/attachment-utils-core';
import {
  detectPreviewFileType,
  getPreviewFileName,
  inferPreviewMimeType,
  readModeForPreviewType,
} from '@/features/preview-runtime/detect-preview-file';
import type {
  PreviewFileDescriptor,
  PreviewLoadedSource,
} from '@/features/preview-runtime/preview-types';
import {
  downloadBinaryFile,
  downloadTextFile,
  fetchWorkspaceFileBlob,
  readWorkspaceFile,
  resolveWorkspaceFileReference,
  writeWorkspaceFile,
} from '@/features/workspace/workspace-api';
import type { WorkspaceEditorRequestOptions } from '@/features/workspace/workspace-api';
import { isElectron } from '@/lib/electron-env';

function useWorkspacePreviewReadOpts({
  projectId,
  sessionKey,
  agentId,
}: {
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
}): WorkspaceEditorRequestOptions | undefined {
  return useMemo(() => {
    const pid = projectId?.trim();
    if (pid) return { projectId: pid };
    const sk = sessionKey?.trim();
    if (sk) return { sessionKey: sk };
    const aid = agentId?.trim();
    return aid ? { agentId: aid } : undefined;
  }, [agentId, projectId, sessionKey]);
}

type WorkspacePreviewLoadState = PreviewLoadedSource & {
  pptxText: string | null;
  pptxTruncated: boolean;
  pptxError: string | null;
};

type EditorUiState = {
  markdownEditMode: boolean;
  htmlCodeMode: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
};

type WorkspacePreviewAction =
  | { type: 'clear'; descriptor: PreviewFileDescriptor }
  | { type: 'loadStart'; descriptor: PreviewFileDescriptor }
  | {
      type: 'loadSuccess';
      payload: {
        descriptor: PreviewFileDescriptor;
        textContent?: string | null;
        binaryBuffer?: ArrayBuffer | null;
        fileResourceId?: string | null;
        mtimeMs?: number | null;
      };
    }
  | { type: 'loadError'; descriptor: PreviewFileDescriptor; error: string }
  | { type: 'patchMtime'; mtimeMs: number }
  | { type: 'patchText'; text: string }
  | { type: 'pptxClear' }
  | { type: 'pptxSuccess'; text: string; truncated: boolean }
  | { type: 'pptxError'; error: string };

function emptyLoaded(descriptor: PreviewFileDescriptor): WorkspacePreviewLoadState {
  return {
    descriptor,
    textContent: null,
    binaryBuffer: null,
    fileResourceId: null,
    mtimeMs: null,
    loadError: null,
    loading: false,
    pptxText: null,
    pptxTruncated: false,
    pptxError: null,
  };
}

function previewReducer(state: WorkspacePreviewLoadState, action: WorkspacePreviewAction): WorkspacePreviewLoadState {
  switch (action.type) {
    case 'clear':
      return emptyLoaded(action.descriptor);
    case 'loadStart':
      return { ...emptyLoaded(action.descriptor), loading: true };
    case 'loadSuccess':
      return {
        ...state,
        descriptor: action.payload.descriptor,
        textContent: action.payload.textContent ?? null,
        binaryBuffer: action.payload.binaryBuffer ?? null,
        fileResourceId: action.payload.fileResourceId ?? null,
        mtimeMs: action.payload.mtimeMs ?? null,
        loadError: null,
        loading: false,
      };
    case 'loadError':
      return { ...emptyLoaded(action.descriptor), loadError: action.error };
    case 'patchMtime':
      return { ...state, mtimeMs: action.mtimeMs };
    case 'patchText':
      return { ...state, textContent: action.text };
    case 'pptxClear':
      return { ...state, pptxText: null, pptxTruncated: false, pptxError: null };
    case 'pptxSuccess':
      return { ...state, pptxText: action.text, pptxTruncated: action.truncated, pptxError: null };
    case 'pptxError':
      return { ...state, pptxText: null, pptxTruncated: false, pptxError: action.error };
  }
}

function editorReducer(state: EditorUiState, action: { type: 'reset' } | { type: 'markdown'; value: boolean | ((p: boolean) => boolean) } | { type: 'html'; value: boolean | ((p: boolean) => boolean) } | { type: 'saveStatus'; value: EditorUiState['saveStatus'] }): EditorUiState {
  switch (action.type) {
    case 'reset':
      return { markdownEditMode: false, htmlCodeMode: false, saveStatus: 'idle' };
    case 'markdown':
      return { ...state, markdownEditMode: typeof action.value === 'function' ? action.value(state.markdownEditMode) : action.value };
    case 'html':
      return { ...state, htmlCodeMode: typeof action.value === 'function' ? action.value(state.htmlCodeMode) : action.value };
    case 'saveStatus':
      return { ...state, saveStatus: action.value };
  }
}

export function useWorkspacePreviewState({
  filePath,
  projectId,
  sessionKey,
  agentId,
}: {
  filePath: string | null;
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
}) {
  const readOpts = useWorkspacePreviewReadOpts({ projectId, sessionKey, agentId });
  const descriptor = useMemo((): PreviewFileDescriptor => {
    const fileName = filePath ? getPreviewFileName(filePath) : '';
    const mimeType = inferPreviewMimeType(fileName, inferMimeTypeFromFileName(fileName));
    const type = filePath ? detectPreviewFileType(fileName, mimeType) : 'unsupported';
    return {
      id: filePath || '__empty__',
      context: 'workspace',
      fileName,
      mimeType,
      type,
      source: { kind: 'workspace', path: filePath || '', sessionKey, agentId },
    };
  }, [agentId, filePath, sessionKey]);

  const [preview, dispatchPreview] = useReducer(previewReducer, descriptor, emptyLoaded);
  const [editorUi, dispatchEditorUi] = useReducer(editorReducer, {
    markdownEditMode: false,
    htmlCodeMode: false,
    saveStatus: 'idle',
  });
  const [recentOpenWithApps, setRecentOpenWithApps] = useState<Array<{ name: string; path: string; lastUsedAt: number }>>([]);
  const [recommendedOpenWithApps, setRecommendedOpenWithApps] = useState<Array<{ name: string; path: string }>>([]);
  const saveStatusClearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trackedFilePathRef = useRef(filePath);

  if (trackedFilePathRef.current !== filePath) {
    trackedFilePathRef.current = filePath;
    dispatchEditorUi({ type: 'reset' });
  }

  useEffect(() => {
    if (!filePath) {
      dispatchPreview({ type: 'clear', descriptor });
      return;
    }

    let cancelled = false;
    dispatchPreview({ type: 'loadStart', descriptor });
    const mode = readModeForPreviewType(descriptor.type);

    const finishError = (err: unknown) => {
      if (!cancelled) dispatchPreview({ type: 'loadError', descriptor, error: err instanceof Error ? err.message : String(err) });
    };

    if (mode === 'metadata') {
      void resolveWorkspaceFileReference(filePath, readOpts)
        .then((ref) => {
          if (!cancelled) {
            dispatchPreview({
              type: 'loadSuccess',
              payload: {
                descriptor,
                fileResourceId: ref?.fileId ?? null,
                mtimeMs: typeof ref?.mtimeMs === 'number' ? ref.mtimeMs : null,
              },
            });
          }
        })
        .catch(finishError);
      return () => {
        cancelled = true;
      };
    }

    if (mode === 'text') {
      void Promise.all([
        readWorkspaceFile(filePath, readOpts),
        resolveWorkspaceFileReference(filePath, readOpts).catch(() => null),
      ])
        .then(([{ content, mtimeMs }, ref]) => {
          if (!cancelled) {
            dispatchPreview({
              type: 'loadSuccess',
              payload: {
                descriptor,
                textContent: content,
                fileResourceId: ref?.fileId ?? null,
                mtimeMs: typeof mtimeMs === 'number' ? mtimeMs : null,
              },
            });
          }
        })
        .catch(finishError);
    } else {
      void Promise.all([
        fetchWorkspaceFileBlob(filePath, readOpts),
        resolveWorkspaceFileReference(filePath, readOpts).catch(() => null),
      ])
        .then(async ([blob, ref]) => {
          const binaryBuffer = await blob.arrayBuffer();
          if (!cancelled) {
            dispatchPreview({
              type: 'loadSuccess',
              payload: {
                descriptor,
                binaryBuffer,
                fileResourceId: ref?.fileId ?? null,
                mtimeMs: typeof ref?.mtimeMs === 'number' ? ref.mtimeMs : null,
              },
            });
          }
        })
        .catch(finishError);
    }

    return () => {
      cancelled = true;
    };
  }, [descriptor, filePath, readOpts]);

  useEffect(() => {
    if (!preview.binaryBuffer || preview.descriptor.type !== 'pptx') {
      dispatchPreview({ type: 'pptxClear' });
      return;
    }
    let cancelled = false;
    dispatchPreview({ type: 'pptxClear' });
    void import('@/features/chat/attachments/attachment-process-heavy')
      .then((mod) => mod.processPptx(preview.binaryBuffer!, preview.descriptor.fileName))
      .then(({ extractedText }) => {
        if (cancelled) return;
        const truncated = extractedText.length > PPTX_PREVIEW_MAX_CHARS;
        dispatchPreview({
          type: 'pptxSuccess',
          text: truncated ? extractedText.slice(0, PPTX_PREVIEW_MAX_CHARS) : extractedText,
          truncated,
        });
      })
      .catch((e) => {
        if (!cancelled) dispatchPreview({ type: 'pptxError', error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [preview.binaryBuffer, preview.descriptor.fileName, preview.descriptor.type]);

  const onSaveMarkdown = useCallback(
    async (next: string) => {
      if (!filePath) return;
      if (saveStatusClearRef.current !== undefined) clearTimeout(saveStatusClearRef.current);
      dispatchEditorUi({ type: 'saveStatus', value: 'saving' });
      try {
        const { mtimeMs } = await writeWorkspaceFile(filePath, next, readOpts);
        if (typeof mtimeMs === 'number') dispatchPreview({ type: 'patchMtime', mtimeMs });
        dispatchEditorUi({ type: 'saveStatus', value: 'saved' });
        saveStatusClearRef.current = setTimeout(() => dispatchEditorUi({ type: 'saveStatus', value: 'idle' }), 2000);
      } catch {
        dispatchEditorUi({ type: 'saveStatus', value: 'error' });
        saveStatusClearRef.current = setTimeout(() => dispatchEditorUi({ type: 'saveStatus', value: 'idle' }), 4000);
      }
    },
    [filePath, readOpts],
  );

  const debouncedHtmlSave = useDebouncedCallback((value: string) => void onSaveMarkdown(value), 500);
  const onHtmlChange = useCallback(
    (next: string) => {
      dispatchPreview({ type: 'patchText', text: next });
      debouncedHtmlSave(next);
    },
    [debouncedHtmlSave],
  );

  const onDownload = useCallback(async () => {
    if (!filePath) return;
    const name = getPreviewFileName(filePath);
    if (preview.binaryBuffer) {
      downloadBinaryFile(name, preview.binaryBuffer, preview.descriptor.mimeType || 'application/octet-stream');
      return;
    }
    if (preview.textContent != null) {
      downloadTextFile(name, preview.textContent);
      return;
    }
    const blob = await fetchWorkspaceFileBlob(filePath, readOpts);
    downloadBinaryFile(name, await blob.arrayBuffer(), preview.descriptor.mimeType || blob.type || 'application/octet-stream');
  }, [filePath, preview.binaryBuffer, preview.descriptor.mimeType, preview.textContent, readOpts]);

  const createAttachmentFile = useCallback(async (): Promise<File> => {
    if (!filePath) throw new Error('No workspace file selected');
    const name = getPreviewFileName(filePath);
    const type = preview.descriptor.mimeType || 'application/octet-stream';
    let blob: Blob;
    if (preview.binaryBuffer) {
      blob = new Blob([preview.binaryBuffer], { type });
    } else if (preview.textContent != null) {
      blob = new Blob([preview.textContent], { type });
    } else {
      blob = await fetchWorkspaceFileBlob(filePath, readOpts);
    }
    return new File([blob], name, {
      type: preview.descriptor.mimeType || blob.type || 'application/octet-stream',
      lastModified: preview.mtimeMs ?? Date.now(),
    });
  }, [filePath, preview.binaryBuffer, preview.descriptor.mimeType, preview.mtimeMs, preview.textContent, readOpts]);

  const canDownload = !preview.loading && Boolean(filePath);
  const canOpenWithSystemApp =
    isElectron()
    && (
      (Boolean(preview.fileResourceId) && Boolean(window.electronAPI?.shell?.openFileResource))
      || (
        preview.descriptor.type === 'spreadsheet'
        && Boolean(preview.binaryBuffer)
        && Boolean(window.electronAPI?.shell?.openTemporaryFile)
      )
    );
  const canChooseOpenWithApp =
    isElectron() && Boolean(preview.fileResourceId) && Boolean(window.electronAPI?.shell?.chooseAppAndOpenFileResource);

  const refreshOpenWithApps = useCallback(async () => {
    const fileResourceId = preview.fileResourceId;
    if (!isElectron() || !fileResourceId || !window.electronAPI?.shell?.getOpenWithAppsForFileResource) {
      setRecommendedOpenWithApps([]);
      setRecentOpenWithApps([]);
      return;
    }
    try {
      const apps = await window.electronAPI.shell.getOpenWithAppsForFileResource(fileResourceId);
      setRecommendedOpenWithApps(apps.recommended.map((app) => ({ name: app.name, path: app.path })));
      setRecentOpenWithApps(apps.recent.map((app) => ({ name: app.name, path: app.path, lastUsedAt: app.lastUsedAt })));
    } catch {
      setRecommendedOpenWithApps([]);
      setRecentOpenWithApps([]);
    }
  }, [preview.fileResourceId]);

  useEffect(() => {
    void refreshOpenWithApps();
  }, [refreshOpenWithApps]);

  const onOpenWithSystemApp = useCallback(async () => {
    const fileResourceId = preview.fileResourceId;
    if (fileResourceId && window.electronAPI?.shell?.openFileResource) {
      return window.electronAPI.shell.openFileResource(fileResourceId);
    }
    if (
      preview.descriptor.type === 'spreadsheet'
      && preview.binaryBuffer
      && window.electronAPI?.shell?.openTemporaryFile
    ) {
      return window.electronAPI.shell.openTemporaryFile({
        fileName: preview.descriptor.fileName,
        data: new Uint8Array(preview.binaryBuffer),
      });
    }
    return undefined;
  }, [preview.binaryBuffer, preview.descriptor.fileName, preview.descriptor.type, preview.fileResourceId]);

  const onChooseOpenWithApp = useCallback(async () => {
    const fileResourceId = preview.fileResourceId;
    if (!fileResourceId || !window.electronAPI?.shell?.chooseAppAndOpenFileResource) return;
    const result = await window.electronAPI.shell.chooseAppAndOpenFileResource(fileResourceId);
    if (result.ok) void refreshOpenWithApps();
  }, [preview.fileResourceId, refreshOpenWithApps]);

  const onOpenWithRecentApp = useCallback(
    async (appPath: string) => {
      const fileResourceId = preview.fileResourceId;
      if (!fileResourceId || !appPath || !window.electronAPI?.shell?.openFileResourceWithApp) return;
      const result = await window.electronAPI.shell.openFileResourceWithApp(fileResourceId, appPath);
      if (result.ok) void refreshOpenWithApps();
    },
    [preview.fileResourceId, refreshOpenWithApps],
  );

  const canRevealInFolder =
    isElectron() && Boolean(preview.fileResourceId) && Boolean(window.electronAPI?.shell?.showFileResourceInFolder);
  const onRevealInFolder = useCallback(async () => {
    const fileResourceId = preview.fileResourceId;
    if (fileResourceId && window.electronAPI?.shell?.showFileResourceInFolder) {
      await window.electronAPI.shell.showFileResourceInFolder(fileResourceId);
    }
  }, [preview.fileResourceId]);

  return {
    ...preview,
    extractedText: preview.descriptor.type === 'pptx' ? preview.pptxText : null,
    extractedTextTruncated: preview.pptxTruncated,
    markdownEditMode: editorUi.markdownEditMode,
    setMarkdownEditMode: (value: boolean | ((p: boolean) => boolean)) => dispatchEditorUi({ type: 'markdown', value }),
    htmlCodeMode: editorUi.htmlCodeMode,
    setHtmlCodeMode: (value: boolean | ((p: boolean) => boolean)) => dispatchEditorUi({ type: 'html', value }),
    saveStatus: editorUi.saveStatus,
    onSaveMarkdown,
    onHtmlChange,
    onDownload,
    createAttachmentFile,
    canDownload,
    canOpenWithSystemApp,
    onOpenWithSystemApp,
    canChooseOpenWithApp,
    onChooseOpenWithApp,
    recommendedOpenWithApps,
    recentOpenWithApps,
    onOpenWithRecentApp,
    canRevealInFolder,
    onRevealInFolder,
  };
}
