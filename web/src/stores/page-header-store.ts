import type { ReactNode } from 'react';
import { create } from 'zustand';

export type PageHeaderPayload = {
  startExtra: ReactNode | null;
  main: ReactNode | null;
  end: ReactNode | null;
  className?: string;
  personalChat?: 'identity' | 'controls';
};

type PageHeaderState = PageHeaderPayload & {
  setPageHeader: (p: PageHeaderPayload) => void;
  clearPageHeader: () => void;
};

const emptyHeader: PageHeaderPayload = {
  startExtra: null,
  main: null,
  end: null,
  className: undefined,
  personalChat: undefined,
};

export const usePageHeaderStore = create<PageHeaderState>((set) => ({
  ...emptyHeader,
  setPageHeader: (p) => set({ ...emptyHeader, ...p }),
  clearPageHeader: () => set(emptyHeader),
}));
