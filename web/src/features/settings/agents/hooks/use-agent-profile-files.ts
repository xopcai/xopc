import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import {
  fetchAgentProfileFileContent,
  fetchAgentProfileFiles,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';

import type { AgentPanel } from '../utils';

export function useAgentProfileFiles(options: {
  panel: AgentPanel;
  selectedId: string | null;
  hasToken: boolean;
  dataAgentsLength: number | undefined;
  saveErrorMessage: string;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { panel, selectedId, hasToken, dataAgentsLength, saveErrorMessage, setError } = options;

  const [files, setFiles] = useState<Awaited<ReturnType<typeof fetchAgentProfileFiles>> | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileDraft, setFileDraft] = useState('');
  const [fileSaving, setFileSaving] = useState(false);
  const [filesViewMode, setFilesViewMode] = useState<'edit' | 'preview'>('edit');
  const [profileFileLoading, setProfileFileLoading] = useState(false);
  const [profileEditorNonce, setProfileEditorNonce] = useState(0);

  const fileDraftRef = useRef(fileDraft);
  fileDraftRef.current = fileDraft;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const overviewSaveProfileMarkdownRef = useRef<(() => Promise<void>) | null>(null);
  const profileFileKeyRef = useRef('');
  const profileSyncedRef = useRef('');

  const saveProfileMarkdownDebounced = useDebouncedCallback(
    async () => {
      const sid = selectedIdRef.current;
      const name = activeFileRef.current;
      if (!sid || !name) {
        return;
      }
      const key = `${sid}:${name}`;
      if (key !== profileFileKeyRef.current) {
        return;
      }
      const draft = fileDraftRef.current;
      if (draft === profileSyncedRef.current) {
        return;
      }
      setFileSaving(true);
      setError(null);
      try {
        await saveAgentProfileFileContent(sid, name, draft);
        profileSyncedRef.current = draft;
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

  const flushProfileSaveRef = useRef(saveProfileMarkdownDebounced.flush);
  flushProfileSaveRef.current = saveProfileMarkdownDebounced.flush;

  useEffect(() => {
    return () => {
      flushProfileSaveRef.current();
    };
  }, []);

  useEffect(() => {
    if (panel !== 'files' || !selectedId || !hasToken) {
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    void fetchAgentProfileFiles(selectedId)
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
    saveProfileMarkdownDebounced.flush();
    setProfileFileLoading(true);
    void fetchAgentProfileFileContent(selectedId, activeFile)
      .then((c) => {
        if (cancelled) {
          return;
        }
        const key = `${selectedId}:${activeFile}`;
        profileFileKeyRef.current = key;
        profileSyncedRef.current = c;
        setFileDraft(c);
        setProfileEditorNonce((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) {
          const key = `${selectedId}:${activeFile}`;
          profileFileKeyRef.current = key;
          profileSyncedRef.current = '';
          setFileDraft('');
          setProfileEditorNonce((n) => n + 1);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProfileFileLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeFile, selectedId, hasToken, saveProfileMarkdownDebounced]);

  useEffect(() => {
    if (!activeFile || !selectedId || profileFileLoading) {
      return;
    }
    saveProfileMarkdownDebounced();
  }, [fileDraft, activeFile, selectedId, profileFileLoading, saveProfileMarkdownDebounced]);

  useEffect(() => {
    if (panel !== 'files') {
      return;
    }
    return () => {
      saveProfileMarkdownDebounced.flush();
    };
  }, [panel, saveProfileMarkdownDebounced]);

  useEffect(() => {
    setFilesViewMode('edit');
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
    filesViewMode,
    setFilesViewMode,
    profileFileLoading,
    profileEditorNonce,
    overviewSaveProfileMarkdownRef,
    saveProfileMarkdownDebounced,
  };
}
