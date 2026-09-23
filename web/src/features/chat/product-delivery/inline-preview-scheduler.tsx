import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const MAX_ACTIVE_PREVIEWS = 2;

type Candidate = {
  element: HTMLElement;
  near: boolean;
  visible: boolean;
  manualPriority: number;
  distance: number;
};

type SchedulerContextValue = {
  activeIds: ReadonlySet<string>;
  nearIds: ReadonlySet<string>;
  register: (id: string, element: HTMLElement | null) => void;
  activate: (id: string) => void;
};

const SchedulerContext = createContext<SchedulerContextValue | null>(null);

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

export function InlinePreviewSchedulerProvider({ children }: { children: ReactNode }) {
  const candidates = useRef(new Map<string, Candidate>());
  const activationSequence = useRef(0);
  const observer = useRef<IntersectionObserver | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set());
  const [nearIds, setNearIds] = useState<ReadonlySet<string>>(new Set());

  const schedule = useCallback(() => {
    if (document.visibilityState === 'hidden') {
      setActiveIds((current) => current.size ? new Set() : current);
      return;
    }
    const eligible = [...candidates.current.entries()]
      .filter(([, candidate]) => candidate.near || candidate.manualPriority > 0)
      .sort(([, left], [, right]) => (
        right.manualPriority - left.manualPriority
        || Number(right.visible) - Number(left.visible)
        || left.distance - right.distance
      ));
    const nextActive = new Set(eligible.slice(0, MAX_ACTIVE_PREVIEWS).map(([id]) => id));
    const nextNear = new Set(eligible.map(([id]) => id));
    setActiveIds((current) => sameIds(current, nextActive) ? current : nextActive);
    setNearIds((current) => sameIds(current, nextNear) ? current : nextNear);
  }, []);

  const register = useCallback((id: string, element: HTMLElement | null) => {
    const previous = candidates.current.get(id);
    if (previous) observer.current?.unobserve(previous.element);
    if (!element) {
      candidates.current.delete(id);
      schedule();
      return;
    }
    candidates.current.set(id, {
      element,
      near: false,
      visible: false,
      manualPriority: previous?.manualPriority ?? 0,
      distance: Number.POSITIVE_INFINITY,
    });
    observer.current?.observe(element);
  }, [schedule]);

  const activate = useCallback((id: string) => {
    const candidate = candidates.current.get(id);
    if (!candidate) return;
    activationSequence.current += 1;
    candidate.manualPriority = activationSequence.current;
    candidate.near = true;
    candidate.visible = true;
    candidate.distance = 0;
    schedule();
  }, [schedule]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    observer.current = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const candidate = [...candidates.current.values()].find((item) => item.element === entry.target);
        if (!candidate) continue;
        const rect = entry.boundingClientRect;
        candidate.near = entry.isIntersecting;
        candidate.visible = entry.isIntersecting && rect.bottom > 0 && rect.top < window.innerHeight;
        candidate.distance = Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
        if (!candidate.near) candidate.manualPriority = 0;
      }
      schedule();
    }, { rootMargin: '480px 0px', threshold: 0 });
    for (const candidate of candidates.current.values()) observer.current.observe(candidate.element);
    const onVisibilityChange = () => schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [schedule]);

  const value = useMemo<SchedulerContextValue>(() => ({ activeIds, nearIds, register, activate }), [activeIds, nearIds, register, activate]);
  return <SchedulerContext.Provider value={value}>{children}</SchedulerContext.Provider>;
}

export function useInlinePreviewLease(id: string): {
  active: boolean;
  state: 'dormant' | 'queued' | 'active';
  containerRef: (element: HTMLElement | null) => void;
  activate: () => void;
} {
  const scheduler = useContext(SchedulerContext);
  const register = scheduler?.register;
  const requestActivation = scheduler?.activate;
  const containerRef = useCallback((element: HTMLElement | null) => register?.(id, element), [id, register]);
  if (!scheduler) return { active: true, state: 'active', containerRef, activate: () => undefined };
  const active = scheduler.activeIds.has(id);
  return {
    active,
    state: active ? 'active' : scheduler.nearIds.has(id) ? 'queued' : 'dormant',
    containerRef,
    activate: () => requestActivation?.(id),
  };
}
