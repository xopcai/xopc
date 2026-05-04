import { create } from 'zustand';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ContextVariables = Record<string, unknown>;

let _contextFetchInflight: Promise<void> | null = null;

type ContextState = {
  variables: ContextVariables;
  loaded: boolean;
  updateContext: (partial: ContextVariables) => void;
  setContext: (variables: ContextVariables) => void;
  fetchContext: () => Promise<void>;
};

export const useContextStore = create<ContextState>((set, get) => ({
  variables: {},
  loaded: false,
  updateContext: (partial) => set((s) => ({ variables: { ...s.variables, ...partial } })),
  setContext: (variables) => set({ variables, loaded: true }),
  fetchContext: async () => {
    if (_contextFetchInflight) return _contextFetchInflight;
    _contextFetchInflight = (async () => {
      const data = await fetchJson<ContextVariables>(apiUrl('/api/context'));
      get().setContext(data);
    })().finally(() => {
      _contextFetchInflight = null;
    });
    return _contextFetchInflight;
  },
}));
