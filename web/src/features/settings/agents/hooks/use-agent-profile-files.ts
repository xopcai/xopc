import { useCallback, useEffect, useRef, useReducer, useState, type Dispatch, type SetStateAction } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import {
  fetchAgentProfileFileContent,
  fetchAgentProfileFiles,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';

import type { AgentPanel } from '../utils';

type ProfileFiles = Awaited<ReturnType<typeof fetchAgentProfileFiles>>;

type FileEditorState = {
  draft: string;
  editorNonce: number;
  loadedKey: string;
};

type FileEditorAction =
  | { type: 'load'; key: string; content: string }
  | { type: 'setDraft'; value: string }
  | { type: 'clear' }
  | { type: 'resetViewMode' };

const initialFileEditor: FileEditorState = {
  draft: '',
  editorNonce: 0,
  loadedKey: '',
};

function fileEditorReducer(state: FileEditorState, action: FileEditorAction): FileEditorState {
  switch (action.type) {
    case 'load':
      return {
        draft: action.content,
        editorNonce: state.editorNonce + 1,
        loadedKey: action.key,
      };
    case 'setDraft':
      return { ...state, draft: action.value };
    case 'clear':
      return { draft: '', editorNonce: state.editorNonce, loadedKey: '' };
    case 'resetViewMode':
      return state;
  }
}

export function useAgentProfileFiles(options: {
  panel: AgentPanel;
  selectedId: string | null;
  hasToken: boolean;
  dataAgentsLength: number | undefined;
  saveErrorMessage: string;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { panel, selectedId, hasToken, dataAgentsLength, saveErrorMessage, setError } = options;

  const filesEnabled = panel === 'advanced' && !!selectedId && hasToken;
  const filesResource = useAsyncResource(
    () => (selectedId ? fetchAgentProfileFiles(selectedId) : Promise.resolve(null as ProfileFiles | null)),
    [panel, selectedId, hasToken, dataAgentsLength],
    { enabled: filesEnabled, initial: null as ProfileFiles | null, errorData: null },
  );
  const files = filesResource.data;
  const setFiles = filesResource.setData;
  const filesLoading = filesResource.loading;
  const [activeFile, setActiveFileState] = useState<string | null>(null);
  const [fileEditor, dispatchFileEditor] = useReducer(fileEditorReducer, initialFileEditor);
  const [fileSaving, setFileSaving] = useState(false);
  const [filesViewMode, setFilesViewMode] = useState<'edit' | 'preview'>('edit');

  // Reset activeFile when selectedId changes so the auto-select effect fires for the new agent
  const prevSelectedIdRef = useRef<string | null>(selectedId);
  useEffect(() => {
    if (selectedId !== prevSelectedIdRef.current) {
      prevSelectedIdRef.current = selectedId;
      setActiveFileState(null);
    }
  }, [selectedId]);

  // Auto-select the first file when files are loaded and no file is active yet
  useEffect(() => {
    if (files && files.files.length > 0 && !activeFile) {
      // Prefer AGENTS.md if available, otherwise pick the first file
      const agentsFile = files.files.find((f) => f.name === 'AGENTS.md');
      setActiveFileState(agentsFile ? agentsFile.name : files.files[0].name);
    }
  }, [files, activeFile]);

  const fileDraft = fileEditor.draft;
  const profileEditorNonce = fileEditor.editorNonce;

  const fileDraftRef = useRef(fileDraft);
  fileDraftRef.current = fileDraft;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const overviewSaveProfileMarkdownRef = useRef<(() => Promise<void>) | null>(null);
  const profileFileKeyRef = useRef('');
  const profileSyncedRef = useRef('');
  const trackedProfileKeyRef = useRef('');
  const flushProfileSaveRef = useRef<() => void>(() => {});

  const profileFileEnabled = Boolean(activeFile && selectedId && hasToken);
  const profileFileResource = useAsyncResource(
    () =>
      activeFile && selectedId
        ? fetchAgentProfileFileContent(selectedId, activeFile).catch(() => '')
        : Promise.resolve(''),
    [activeFile, selectedId, hasToken],
    { enabled: profileFileEnabled, initial: '', errorData: '' },
  );
  const profileFileLoading = profileFileResource.loading;

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

  flushProfileSaveRef.current = saveProfileMarkdownDebounced.flush;

  useEffect(() => {
    return () => {
      flushProfileSaveRef.current();
    };
  }, []);

  const trackedPanelRef = useRef(panel);
  if (trackedPanelRef.current !== panel) {
    if (trackedPanelRef.current === 'advanced') {
      flushProfileSaveRef.current();
    }
    trackedPanelRef.current = panel;
  }

  const profileFileKey = activeFile && selectedId ? `${selectedId}:${activeFile}` : '';

  useEffect(() => {
    if (profileFileKey !== trackedProfileKeyRef.current) {
      flushProfileSaveRef.current();
      trackedProfileKeyRef.current = profileFileKey;
    }
  }, [profileFileKey]);

  // Load editor content only after the profile file fetch settles for the active key.
  // Render-time sync previously loaded stale/empty cache data before useAsyncResource
  // started loading, then skipped the real payload because loadedKey already matched.
  useEffect(() => {
    if (!profileFileKey) {
      dispatchFileEditor({ type: 'clear' });
      return;
    }
    if (profileFileLoading) {
      return;
    }
    profileFileKeyRef.current = profileFileKey;
    profileSyncedRef.current = profileFileResource.data;
    dispatchFileEditor({
      type: 'load',
      key: profileFileKey,
      content: profileFileResource.data,
    });
  }, [profileFileKey, profileFileLoading, profileFileResource.data]);

  const trackedViewModeKeyRef = useRef({ activeFile, selectedId });
  if (
    trackedViewModeKeyRef.current.activeFile !== activeFile ||
    trackedViewModeKeyRef.current.selectedId !== selectedId
  ) {
    trackedViewModeKeyRef.current = { activeFile, selectedId };
    setFilesViewMode('edit');
  }

  const setActiveFile = useCallback((value: string | null) => {
    flushProfileSaveRef.current();
    setActiveFileState(value);
  }, []);

  const setFileDraft = useCallback(
    (value: SetStateAction<string>) => {
      dispatchFileEditor({
        type: 'setDraft',
        value: typeof value === 'function' ? value(fileDraftRef.current) : value,
      });
      saveProfileMarkdownDebounced();
    },
    [saveProfileMarkdownDebounced],
  );

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
