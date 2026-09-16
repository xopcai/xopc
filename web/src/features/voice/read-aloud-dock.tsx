import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const DockContext = createContext<{
  target: HTMLDivElement | null;
  register: (node: HTMLDivElement) => () => void;
}>({ target: null, register: () => () => {} });

/** The most recently mounted chat owns the dock, including a chat opened in a dialog. */
export function ReadAloudDockProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<HTMLDivElement[]>([]);
  const register = useCallback((node: HTMLDivElement) => {
    setTargets((current) => [...current, node]);
    return () => setTargets((current) => current.filter((target) => target !== node));
  }, []);
  const value = useMemo(() => ({ target: targets.at(-1) ?? null, register }), [targets, register]);
  return <DockContext value={value}>{children}</DockContext>;
}

export function ReadAloudDock() {
  const { register } = useContext(DockContext);
  return <div ref={register} className="min-w-0 shrink-0" />;
}

export function useReadAloudDock() {
  return useContext(DockContext).target;
}
