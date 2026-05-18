import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import {
  fetchAgentProfileFileContent,
  fetchAgentProfileFiles,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';

import type { AgentPanel } from '../utils';

type ProfileFiles = Awaited<ReturnType<typeof fetchAgentProfileFiles>>;

export function useAgentProfileFiles(options: {
  panel: AgentPanel;
  selectedId: string | null;
  hasToken: boolean;
  dataAgentsLength: number | undefined;
  saveErrorMessage: string;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { panel, selectedId, hasToken, dataAgentsLength, saveErrorMessage, setError } = options;

  const filesEnabled = panel === 'files' && !!selectedId && hasToken;
  const filesResource = useAsyncResource(
    () => (selectedId ? fetchAgentProfileFiles(selectedId) : Promise.resolve(null as ProfileFiles | null)),
    [panel, selectedId, hasToken, dataAgentsLength],
    { enabled: filesEnabled, initial: null as ProfileFiles | null, errorData: null },
  );
  const files = filesResource.data;
  const setFiles = filesResource.setData;
  const filesLoading = filesResource.loading;
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

  const trackedViewModeKeyRef = useRef({ activeFile, selectedId });
  if (
    trackedViewModeKeyRef.current.activeFile !== activeFile ||
    trackedViewModeKeyRef.current.selectedId !== selectedId
  ) {
    trackedViewModeKeyRef.current = { activeFile, selectedId };
    setFilesViewMode('edit');
  }

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
