import { create } from 'zustand';

export interface EditorState {
  rootDir: string | null;
  selectedPath: string | null;
  fileContent: string;
  setRootDir: (path: string | null) => void;
  setSelectedPath: (path: string | null) => void;
  setFileContent: (content: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  rootDir: null,
  selectedPath: null,
  fileContent: '',
  setRootDir: (path) => set({ rootDir: path }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  setFileContent: (content) => set({ fileContent: content }),
}));
