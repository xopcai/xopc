import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import {
  base64ToArrayBuffer,
  inferMimeTypeFromFileName,
  PPTX_PREVIEW_MAX_CHARS,
} from '@/features/chat/attachment-utils-core';
import { downloadBinaryFile, downloadTextFile, readWorkspaceFile, readWorkspaceFileBase64, writeWorkspaceFile } from '@/features/workspace/workspace-api';
import { isElectron } from '@/lib/electron-env';
import { getFileExtension, getFileName, isBinaryOnlyPreviewExt, isImagePreviewExt } from '@/features/file-preview/utils';
import type { FilePreviewKind } from '@/features/file-preview/types';

export type WorkspacePreviewReadOpts = { sessionKey: string } | { agentId: string } | undefined;

export function useWorkspacePreviewReadOpts({
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
};

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

  const [textContent, setTextContent] = useState<string | null>(null);
  const [binaryBuffer, setBinaryBuffer] = useState<ArrayBuffer | null>(null);
  const [previewKind, setPreviewKind] = useState<FilePreviewKind | null>(null);
  const [hostAbsolutePath, setHostAbsolutePath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);

  const [markdownEditMode, setMarkdownEditMode] = useState(false);
  const [htmlCodeMode, setHtmlCodeMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveStatusClearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [pptxText, setPptxText] = useState<string | null>(null);
  const [pptxTruncated, setPptxTruncated] = useState(false);
  const [pptxError, setPptxError] = useState<string | null>(null);

  useEffect(() => {
    setMarkdownEditMode(false);
    setHtmlCodeMode(false);
  }, [filePath]);

  useEffect(() => {
    setPptxText(null);
    setPptxTruncated(false);
    setPptxError(null);

    if (!filePath) {
      setTextContent(null);
      setBinaryBuffer(null);
      setPreviewKind(null);
      setHostAbsolutePath(null);
      setMtimeMs(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    const ext = getFileExtension(filePath);
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setTextContent(null);
    setBinaryBuffer(null);
    setPreviewKind(null);
    setHostAbsolutePath(null);
    setMtimeMs(null);

    const loadBinary = (kind: FilePreviewKind) => {
      void readWorkspaceFileBase64(filePath, readOpts)
        .then(({ contentBase64, mtimeMs: mt, absolutePath }) => {
          if (cancelled) return;
          setBinaryBuffer(base64ToArrayBuffer(contentBase64));
          setPreviewKind(kind);
          setHostAbsolutePath(typeof absolutePath === 'string' && absolutePath.length > 0 ? absolutePath : null);
          setMtimeMs(typeof mt === 'number' && Number.isFinite(mt) ? mt : null);
        })
        .catch((err) => {
          if (!cancelled) {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
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
        .then(({ content: text, mtimeMs: mt }) => {
          if (cancelled) return;
          setTextContent(text);
          setPreviewKind('text');
          setMtimeMs(typeof mt === 'number' && Number.isFinite(mt) ? mt : null);
        })
        .catch((err) => {
          if (!cancelled) {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [filePath, readOpts]);

  useEffect(() => {
    if (!binaryBuffer || previewKind !== 'pptx' || !filePath) {
      return;
    }
    let cancelled = false;
    setPptxText(null);
    setPptxTruncated(false);
    setPptxError(null);

    const pptxName = getFileName(filePath);

    void (async () => {
      try {
        const mod = await import('@/features/chat/attachment-process-heavy');
        const { extractedText } = await mod.processPptx(binaryBuffer, pptxName);
        if (cancelled) return;
        const cap = PPTX_PREVIEW_MAX_CHARS;
        const truncated = extractedText.length > cap;
        setPptxText(truncated ? extractedText.slice(0, cap) : extractedText);
        setPptxTruncated(truncated);
      } catch (e) {
        if (!cancelled) {
          setPptxError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [binaryBuffer, previewKind, filePath]);

  const onSaveMarkdown = useCallback(
    async (next: string) => {
      if (!filePath) return;
      if (saveStatusClearRef.current !== undefined) {
        clearTimeout(saveStatusClearRef.current);
        saveStatusClearRef.current = undefined;
      }
      setSaveStatus('saving');
      try {
        const { mtimeMs: writtenMtime } = await writeWorkspaceFile(
          filePath,
          next,
          agentId?.trim() ? { agentId: agentId.trim() } : undefined,
        );
        if (typeof writtenMtime === 'number' && Number.isFinite(writtenMtime)) {
          setMtimeMs(writtenMtime);
        }
        setSaveStatus('saved');
        saveStatusClearRef.current = setTimeout(() => {
          setSaveStatus('idle');
          saveStatusClearRef.current = undefined;
        }, 2000);
      } catch {
        setSaveStatus('idle');
      }
    },
    [filePath, agentId],
  );

  const debouncedHtmlSave = useDebouncedCallback((value: string) => {
    void onSaveMarkdown(value);
  }, 500);

  const onHtmlChange = useCallback(
    (next: string) => {
      setTextContent(next);
      debouncedHtmlSave(next);
    },
    [debouncedHtmlSave],
  );

  const onDownload = useCallback(async () => {
    if (!filePath) return;
    const name = getFileName(filePath);
    if (binaryBuffer) {
      const mime = inferMimeTypeFromFileName(name) ?? 'application/octet-stream';
      downloadBinaryFile(name, binaryBuffer, mime);
      return;
    }
    if (textContent != null) {
      downloadTextFile(name, textContent);
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
  }, [binaryBuffer, filePath, readOpts, textContent]);

  const canDownload = !loading && (binaryBuffer != null || textContent != null || loadError != null);

  const canOpenWithSystemApp =
    isElectron() && Boolean(hostAbsolutePath) && Boolean(window.electronAPI?.shell?.openPath);

  const onOpenWithSystemApp = useCallback(async () => {
    const p = hostAbsolutePath;
    if (!p || !window.electronAPI?.shell?.openPath) return;
    await window.electronAPI.shell.openPath(p);
  }, [hostAbsolutePath]);

  return {
    previewKind,
    loading,
    loadError,
    textContent,
    binaryBuffer,
    hostAbsolutePath,
    mtimeMs,

    pptxText,
    pptxTruncated,
    pptxError,

    markdownEditMode,
    setMarkdownEditMode,
    htmlCodeMode,
    setHtmlCodeMode,
    saveStatus,

    onSaveMarkdown,
    onHtmlChange,

    onDownload,
    canDownload,

    canOpenWithSystemApp,
    onOpenWithSystemApp,
  };
}

