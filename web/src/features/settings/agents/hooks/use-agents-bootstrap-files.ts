import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import {
  fetchAgentBootstrapFileContent,
  fetchAgentBootstrapFiles,
  saveAgentBootstrapFileContent,
} from '@/features/settings/agents-admin-api';

import type { AgentPanel } from '../utils';

export function useAgentsBootstrapFiles(options: {
  panel: AgentPanel;
  selectedId: string | null;
  hasToken: boolean;
  dataAgentsLength: number | undefined;
  saveErrorMessage: string;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { panel, selectedId, hasToken, dataAgentsLength, saveErrorMessage, setError } = options;

  const [files, setFiles] = useState<Awaited<ReturnType<typeof fetchAgentBootstrapFiles>> | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileDraft, setFileDraft] = useState('');
  const [fileSaving, setFileSaving] = useState(false);
  const [bootstrapViewMode, setBootstrapViewMode] = useState<'edit' | 'preview'>('edit');
  const [bootstrapFileLoading, setBootstrapFileLoading] = useState(false);
  const [bootstrapEditorNonce, setBootstrapEditorNonce] = useState(0);

  const fileDraftRef = useRef(fileDraft);
  fileDraftRef.current = fileDraft;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const overviewSaveBootstrapRef = useRef<(() => Promise<void>) | null>(null);
  const bootstrapFileKeyRef = useRef('');
  const bootstrapSyncedRef = useRef('');

  const saveBootstrapDebounced = useDebouncedCallback(
    async () => {
      const sid = selectedIdRef.current;
      const name = activeFileRef.current;
      if (!sid || !name) {
        return;
      }
      const key = `${sid}:${name}`;
      if (key !== bootstrapFileKeyRef.current) {
        return;
      }
      const draft = fileDraftRef.current;
      if (draft === bootstrapSyncedRef.current) {
        return;
      }
      setFileSaving(true);
      setError(null);
      try {
        await saveAgentBootstrapFileContent(sid, name, draft);
        bootstrapSyncedRef.current = draft;
        setFiles((prev) => {
          if (!prev || prev.agentId !== sid) {
            return prev;
          }
          return {
            ...prev,
            files: prev.files.map((f) => (f.name === name ? { ...f, missing: false } : f)),
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : saveErrorMessage);
      } finally {
        setFileSaving(false);
      }
    },
    800,
  );

  const flushBootstrapSaveRef = useRef(saveBootstrapDebounced.flush);
  flushBootstrapSaveRef.current = saveBootstrapDebounced.flush;

  useEffect(() => {
    return () => {
      flushBootstrapSaveRef.current();
    };
  }, []);

  useEffect(() => {
    if (panel !== 'files' || !selectedId || !hasToken) {
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    void fetchAgentBootstrapFiles(selectedId)
      .then((f) => {
        if (!cancelled) {
          setFiles(f);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFiles(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFilesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, selectedId, hasToken, dataAgentsLength]);

  useEffect(() => {
    if (!activeFile || !selectedId || !hasToken) {
      return;
    }
    let cancelled = false;
    saveBootstrapDebounced.flush();
    setBootstrapFileLoading(true);
    void fetchAgentBootstrapFileContent(selectedId, activeFile)
      .then((c) => {
        if (cancelled) {
          return;
        }
        const key = `${selectedId}:${activeFile}`;
        bootstrapFileKeyRef.current = key;
        bootstrapSyncedRef.current = c;
        setFileDraft(c);
        setBootstrapEditorNonce((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) {
          const key = `${selectedId}:${activeFile}`;
          bootstrapFileKeyRef.current = key;
          bootstrapSyncedRef.current = '';
          setFileDraft('');
          setBootstrapEditorNonce((n) => n + 1);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapFileLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeFile, selectedId, hasToken, saveBootstrapDebounced]);

  useEffect(() => {
    if (!activeFile || !selectedId || bootstrapFileLoading) {
      return;
    }
    saveBootstrapDebounced();
  }, [fileDraft, activeFile, selectedId, bootstrapFileLoading, saveBootstrapDebounced]);

  useEffect(() => {
    if (panel !== 'files') {
      return;
    }
    return () => {
      saveBootstrapDebounced.flush();
    };
  }, [panel, saveBootstrapDebounced]);

  useEffect(() => {
    setBootstrapViewMode('edit');
  }, [activeFile, selectedId]);

  return {
    files,
    setFiles,
    filesLoading,
    activeFile,
    setActiveFile,
    fileDraft,
    setFileDraft,
    fileSaving,
    bootstrapViewMode,
    setBootstrapViewMode,
    bootstrapFileLoading,
    bootstrapEditorNonce,
    overviewSaveBootstrapRef,
    saveBootstrapDebounced,
  };
}
