import type { ReactNode } from 'react';
import { create } from 'zustand';

export type PageHeaderPayload = {
  startExtra: ReactNode | null;
  main: ReactNode | null;
  end: ReactNode | null;
  className?: string;
};

type PageHeaderState = PageHeaderPayload & {
  setPageHeader: (p: PageHeaderPayload) => void;
  clearPageHeader: () => void;
};

const emptyHeader: PageHeaderPayload = {
  startExtra: null,
  main: null,
  end: null,
};

export const usePageHeaderStore = create<PageHeaderState>((set) => ({
  ...emptyHeader,
  setPageHeader: (p) => set(p),
  clearPageHeader: () => set(emptyHeader),
}));
