import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import {
  base64ToArrayBuffer,
  inferMimeTypeFromFileName,
  PPTX_PREVIEW_MAX_CHARS,
} from '@/features/chat/attachments/attachment-utils-core';
import { downloadBinaryFile, downloadTextFile, readWorkspaceFile, readWorkspaceFileBase64, writeWorkspaceFile } from '@/features/workspace/workspace-api';
import { isElectron } from '@/lib/electron-env';
import { getFileExtension, getFileName, isBinaryOnlyPreviewExt, isImagePreviewExt } from '@/features/file-preview/utils';
import type { FilePreviewKind } from '@/features/file-preview/types';

export type WorkspacePreviewReadOpts = { sessionKey: string } | { agentId: string } | undefined;

function useWorkspacePreviewReadOpts({
  sessionKey,
  agentId,
}: {
  sessionKey?: string;
  agentId?: string;
}): WorkspacePreviewReadOpts {
  return useMemo(() => {
    const sk = sessionKey?.trim();
    if (sk) return { sessionKey: sk };
    const aid = agentId?.trim();
    return aid ? { agentId: aid } : undefined;
  }, [sessionKey, agentId]);
}

export type WorkspaceFilePreviewState = {
  previewKind: FilePreviewKind | null;
  loading: boolean;
  loadError: string | null;
  textContent: string | null;
  binaryBuffer: ArrayBuffer | null;
  hostAbsolutePath: string | null;
  mtimeMs: number | null;

  pptxText: string | null;
  pptxTruncated: boolean;
  pptxError: string | null;

  markdownEditMode: boolean;
  setMarkdownEditMode: (v: boolean | ((p: boolean) => boolean)) => void;
  htmlCodeMode: boolean;
  setHtmlCodeMode: (v: boolean | ((p: boolean) => boolean)) => void;

  saveStatus: 'idle' | 'saving' | 'saved';

  onSaveMarkdown: (next: string) => Promise<void>;
  onHtmlChange: (next: string) => void;

  onDownload: () => Promise<void>;
  canDownload: boolean;

  canOpenWithSystemApp: boolean;
  onOpenWithSystemApp: () => Promise<void>;

  canRevealInFolder: boolean;
  onRevealInFolder: () => Promise<void>;
};

type PreviewLoadState = {
  textContent: string | null;
  binaryBuffer: ArrayBuffer | null;
  previewKind: FilePreviewKind | null;
  hostAbsolutePath: string | null;
  loadError: string | null;
  loading: boolean;
  mtimeMs: number | null;
};

const emptyPreviewLoad: PreviewLoadState = {
  textContent: null,
  binaryBuffer: null,
  previewKind: null,
  hostAbsolutePath: null,
  loadError: null,
  loading: false,
  mtimeMs: null,
};

type PreviewLoadAction =
  | { type: 'clear' }
  | { type: 'loadStart' }
  | {
      type: 'loadSuccess';
      payload: {
        previewKind: FilePreviewKind;
        textContent?: string | null;
        binaryBuffer?: ArrayBuffer | null;
        hostAbsolutePath: string | null;
        mtimeMs: number | null;
      };
    }
  | { type: 'loadError'; error: string }
  | { type: 'patchMtime'; mtimeMs: number }
  | { type: 'patchText'; text: string };

function previewLoadReducer(state: PreviewLoadState, action: PreviewLoadAction): PreviewLoadState {
  switch (action.type) {
    case 'clear':
      return emptyPreviewLoad;
    case 'loadStart':
      return { ...emptyPreviewLoad, loading: true };
    case 'loadSuccess':
      return {
        textContent: action.payload.textContent ?? null,
        binaryBuffer: action.payload.binaryBuffer ?? null,
        previewKind: action.payload.previewKind,
        hostAbsolutePath: action.payload.hostAbsolutePath,
        loadError: null,
        loading: false,
        mtimeMs: action.payload.mtimeMs,
      };
    case 'loadError':
      return { ...emptyPreviewLoad, loading: false, loadError: action.error };
    case 'patchMtime':
      return { ...state, mtimeMs: action.mtimeMs };
    case 'patchText':
      return { ...state, textContent: action.text };
  }
}

type PptxPreviewState = {
  text: string | null;
  truncated: boolean;
  error: string | null;
};

const emptyPptxPreview: PptxPreviewState = { text: null, truncated: false, error: null };

type PptxPreviewAction =
  | { type: 'clear' }
  | { type: 'success'; text: string; truncated: boolean }
  | { type: 'error'; error: string };

function pptxPreviewReducer(_state: PptxPreviewState, action: PptxPreviewAction): PptxPreviewState {
  switch (action.type) {
    case 'clear':
      return emptyPptxPreview;
    case 'success':
      return { text: action.text, truncated: action.truncated, error: null };
    case 'error':
      return { ...emptyPptxPreview, error: action.error };
  }
}

type EditorUiState = {
  markdownEditMode: boolean;
  htmlCodeMode: boolean;
  saveStatus: 'idle' | 'saving' | 'saved';
};

const emptyEditorUi: EditorUiState = {
  markdownEditMode: false,
  htmlCodeMode: false,
  saveStatus: 'idle',
};

type EditorUiAction =
  | { type: 'resetModes' }
  | { type: 'setMarkdownEditMode'; value: boolean | ((prev: boolean) => boolean) }
  | { type: 'setHtmlCodeMode'; value: boolean | ((prev: boolean) => boolean) }
  | { type: 'setSaveStatus'; value: EditorUiState['saveStatus'] };

function editorUiReducer(state: EditorUiState, action: EditorUiAction): EditorUiState {
  switch (action.type) {
    case 'resetModes':
      return { ...state, markdownEditMode: false, htmlCodeMode: false };
    case 'setMarkdownEditMode':
      return {
        ...state,
        markdownEditMode:
          typeof action.value === 'function' ? action.value(state.markdownEditMode) : action.value,
      };
    case 'setHtmlCodeMode':
      return {
        ...state,
        htmlCodeMode: typeof action.value === 'function' ? action.value(state.htmlCodeMode) : action.value,
      };
    case 'setSaveStatus':
      return { ...state, saveStatus: action.value };
  }
}

export function useWorkspaceFilePreviewState({
  filePath,
  sessionKey,
  agentId,
}: {
  filePath: string | null;
  sessionKey?: string;
  agentId?: string;
}): WorkspaceFilePreviewState {
  const readOpts = useWorkspacePreviewReadOpts({ sessionKey, agentId });

  const [preview, dispatchPreview] = useReducer(previewLoadReducer, emptyPreviewLoad);
  const [pptxPreview, dispatchPptx] = useReducer(pptxPreviewReducer, emptyPptxPreview);
  const [editorUi, dispatchEditorUi] = useReducer(editorUiReducer, emptyEditorUi);
  const saveStatusClearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const trackedFilePathRef = useRef(filePath);
  if (trackedFilePathRef.current !== filePath) {
    trackedFilePathRef.current = filePath;
    dispatchEditorUi({ type: 'resetModes' });
    dispatchPptx({ type: 'clear' });
  }

  useEffect(() => {
    dispatchPptx({ type: 'clear' });

    if (!filePath) {
      dispatchPreview({ type: 'clear' });
      return;
    }

    const ext = getFileExtension(filePath);
    let cancelled = false;
    dispatchPreview({ type: 'loadStart' });

    const finishSuccess = (payload: Extract<PreviewLoadAction, { type: 'loadSuccess' }>['payload']) => {
      if (!cancelled) dispatchPreview({ type: 'loadSuccess', payload });
    };
    const finishError = (err: unknown) => {
      if (!cancelled) {
        dispatchPreview({ type: 'loadError', error: err instanceof Error ? err.message : String(err) });
      }
    };

    const loadBinary = (kind: FilePreviewKind) => {
      void readWorkspaceFileBase64(filePath, readOpts)
        .then(({ contentBase64, mtimeMs: mt, absolutePath }) => {
          finishSuccess({
            previewKind: kind,
            binaryBuffer: base64ToArrayBuffer(contentBase64),
            hostAbsolutePath: typeof absolutePath === 'string' && absolutePath.length > 0 ? absolutePath : null,
            mtimeMs: typeof mt === 'number' && Number.isFinite(mt) ? mt : null,
          });
        })
        .catch(finishError);
    };

    if (ext === '.pdf') {
      loadBinary('pdf');
    } else if (ext === '.xlsx' || ext === '.xls') {
      loadBinary('excel');
    } else if (ext === '.docx') {
      loadBinary('docx');
    } else if (ext === '.pptx') {
      loadBinary('pptx');
    } else if (isBinaryOnlyPreviewExt(ext)) {
      loadBinary('binaryOnly');
    } else if (isImagePreviewExt(ext)) {
      loadBinary('image');
    } else {
      void readWorkspaceFile(filePath, readOpts)
        .then(({ content: text, mtimeMs: mt, absolutePath }) => {
          finishSuccess({
            previewKind: 'text',
            textContent: text,
            hostAbsolutePath: typeof absolutePath === 'string' && absolutePath.length > 0 ? absolutePath : null,
            mtimeMs: typeof mt === 'number' && Number.isFinite(mt) ? mt : null,
          });
        })
        .catch(finishError);
    }

    return () => {
      cancelled = true;
    };
  }, [filePath, readOpts]);

  useEffect(() => {
    if (!preview.binaryBuffer || preview.previewKind !== 'pptx' || !filePath) {
      return;
    }
    let cancelled = false;
    dispatchPptx({ type: 'clear' });

    const pptxName = getFileName(filePath);

    void (async () => {
      try {
        const mod = await import('@/features/chat/attachments/attachment-process-heavy');
        const { extractedText } = await mod.processPptx(preview.binaryBuffer!, pptxName);
        if (cancelled) return;
        const cap = PPTX_PREVIEW_MAX_CHARS;
        const truncated = extractedText.length > cap;
        dispatchPptx({
          type: 'success',
          text: truncated ? extractedText.slice(0, cap) : extractedText,
          truncated,
        });
      } catch (e) {
        if (!cancelled) {
          dispatchPptx({ type: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preview.binaryBuffer, preview.previewKind, filePath]);

  const onSaveMarkdown = useCallback(
    async (next: string) => {
      if (!filePath) return;
      if (saveStatusClearRef.current !== undefined) {
        clearTimeout(saveStatusClearRef.current);
        saveStatusClearRef.current = undefined;
      }
      dispatchEditorUi({ type: 'setSaveStatus', value: 'saving' });
      try {
        const { mtimeMs: writtenMtime } = await writeWorkspaceFile(
          filePath,
          next,
          agentId?.trim() ? { agentId: agentId.trim() } : undefined,
        );
        if (typeof writtenMtime === 'number' && Number.isFinite(writtenMtime)) {
          dispatchPreview({ type: 'patchMtime', mtimeMs: writtenMtime });
        }
        dispatchEditorUi({ type: 'setSaveStatus', value: 'saved' });
        saveStatusClearRef.current = setTimeout(() => {
          dispatchEditorUi({ type: 'setSaveStatus', value: 'idle' });
          saveStatusClearRef.current = undefined;
        }, 2000);
      } catch {
        dispatchEditorUi({ type: 'setSaveStatus', value: 'idle' });
      }
    },
    [filePath, agentId],
  );

  const debouncedHtmlSave = useDebouncedCallback((value: string) => {
    void onSaveMarkdown(value);
  }, 500);

  const onHtmlChange = useCallback(
    (next: string) => {
      dispatchPreview({ type: 'patchText', text: next });
      debouncedHtmlSave(next);
    },
    [debouncedHtmlSave],
  );

  const onDownload = useCallback(async () => {
    if (!filePath) return;
    const name = getFileName(filePath);
    if (preview.binaryBuffer) {
      const mime = inferMimeTypeFromFileName(name) ?? 'application/octet-stream';
      downloadBinaryFile(name, preview.binaryBuffer, mime);
      return;
    }
    if (preview.textContent != null) {
      downloadTextFile(name, preview.textContent);
      return;
    }
    try {
      const { contentBase64 } = await readWorkspaceFileBase64(filePath, readOpts);
      const buf = base64ToArrayBuffer(contentBase64);
      const mime = inferMimeTypeFromFileName(name) ?? 'application/octet-stream';
      downloadBinaryFile(name, buf, mime);
    } catch {
      /* ignore */
    }
  }, [preview.binaryBuffer, preview.textContent, filePath, readOpts]);

  const canDownload =
    !preview.loading && (preview.binaryBuffer != null || preview.textContent != null || preview.loadError != null);

  const canOpenWithSystemApp =
    isElectron() && Boolean(preview.hostAbsolutePath) && Boolean(window.electronAPI?.shell?.openPath);

  const onOpenWithSystemApp = useCallback(async () => {
    const p = preview.hostAbsolutePath;
    if (!p || !window.electronAPI?.shell?.openPath) return;
    await window.electronAPI.shell.openPath(p);
  }, [preview.hostAbsolutePath]);

  const canRevealInFolder =
    isElectron() && Boolean(preview.hostAbsolutePath) && Boolean(window.electronAPI?.shell?.showItemInFolder);

  const onRevealInFolder = useCallback(async () => {
    const p = preview.hostAbsolutePath;
    if (!p || !window.electronAPI?.shell?.showItemInFolder) return;
    await window.electronAPI.shell.showItemInFolder(p);
  }, [preview.hostAbsolutePath]);

  const setMarkdownEditMode = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      dispatchEditorUi({ type: 'setMarkdownEditMode', value });
    },
    [],
  );

  const setHtmlCodeMode = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      dispatchEditorUi({ type: 'setHtmlCodeMode', value });
    },
    [],
  );

  return {
    previewKind: preview.previewKind,
    loading: preview.loading,
    loadError: preview.loadError,
    textContent: preview.textContent,
    binaryBuffer: preview.binaryBuffer,
    hostAbsolutePath: preview.hostAbsolutePath,
    mtimeMs: preview.mtimeMs,

    pptxText: pptxPreview.text,
    pptxTruncated: pptxPreview.truncated,
    pptxError: pptxPreview.error,

    markdownEditMode: editorUi.markdownEditMode,
    setMarkdownEditMode,
    htmlCodeMode: editorUi.htmlCodeMode,
    setHtmlCodeMode,
    saveStatus: editorUi.saveStatus,

    onSaveMarkdown,
    onHtmlChange,

    onDownload,
    canDownload,

    canOpenWithSystemApp,
    onOpenWithSystemApp,

    canRevealInFolder,
    onRevealInFolder,
  };
}
