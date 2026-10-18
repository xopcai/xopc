import { createContext, useContext, type ReactNode } from 'react';

export const WorkspaceOwnerContext = createContext<string | null>(null);
export function useWorkspaceOwner() { return useContext(WorkspaceOwnerContext); }

export const WorkspaceFileTargetsContext = createContext<Array<{ id: string; label: string }>>([]);

export const WorkspaceTreeControlContext = createContext<{ button: ReactNode; label: string; active: boolean; onToggle: () => void } | null>(null);
