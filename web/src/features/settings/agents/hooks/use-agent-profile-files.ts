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

  const filesEnabled = panel === 'files' && !!selectedId && hasToken;
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
    if (trackedPanelRef.current === 'files') {
      flushProfileSaveRef.current();
    }
    trackedPanelRef.current = panel;
  }

  const profileFileKey = activeFile && selectedId ? `${selectedId}:${activeFile}` : '';

  if (profileFileKey !== trackedProfileKeyRef.current) {
    flushProfileSaveRef.current();
    trackedProfileKeyRef.current = profileFileKey;
  }
  if (!profileFileKey) {
    if (fileEditor.loadedKey !== '') {
      dispatchFileEditor({ type: 'clear' });
    }
  } else if (!profileFileLoading && fileEditor.loadedKey !== profileFileKey) {
    profileFileKeyRef.current = profileFileKey;
    profileSyncedRef.current = profileFileResource.data;
    dispatchFileEditor({
      type: 'load',
      key: profileFileKey,
      content: profileFileResource.data,
    });
  }

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
