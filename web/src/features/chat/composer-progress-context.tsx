import { createContext, useContext, type ReactNode } from 'react';

import type { ProgressState } from '@/features/chat/messages.types';

const ComposerProgressContext = createContext<ProgressState | null>(null);

export function ComposerProgressProvider({
  value,
  children,
}: {
  value: ProgressState | null;
  children: ReactNode;
}) {
  return <ComposerProgressContext.Provider value={value}>{children}</ComposerProgressContext.Provider>;
}

export function useComposerProgress(): ProgressState | null {
  return useContext(ComposerProgressContext);
}
