import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useMessages } from '../../i18n/messages';
import {
  hapticAskAiDismiss,
  hapticAskAiPress,
  hapticAskAiSettle,
  motion,
  useReducedMotion,
} from '../../motion';

import type {
  FinalizeAskAiHandler,
  LayoutMeasurer,
  LayoutRect,
  WorkspaceTransitionPhase,
} from './workspace-transition.types';

export type WorkspaceTransitionContextValue = {
  phase: WorkspaceTransitionPhase;
  progress: SharedValue<number>;
  dismissDrag: SharedValue<number>;
  isChatWarm: boolean;
  /** Session key for the overlay chat — resolved when Ask AI opens. */
  overlaySessionKey: string;
  pillAnchor: LayoutRect | null;
  composerAnchor: LayoutRect | null;
  registerPillMeasurer: (measurer: LayoutMeasurer | null) => void;
  registerComposerMeasurer: (measurer: LayoutMeasurer | null) => void;
  registerFinalizeHandler: (handler: FinalizeAskAiHandler | null) => void;
  notifyComposerAnchor: (rect: LayoutRect) => void;
  openAskAi: (sessionKey: string) => Promise<void>;
  closeAskAi: () => void;
  completeInteractiveDismiss: () => void;
  cancelInteractiveDismiss: () => void;
  setDismissDragFraction: (fraction: number) => void;
};

const WorkspaceTransitionContext = createContext<WorkspaceTransitionContextValue | null>(null);

type WorkspaceTransitionProviderProps = {
  children: ReactNode;
  onClosed?: () => void;
};

export function WorkspaceTransitionProvider({ children, onClosed }: WorkspaceTransitionProviderProps) {
  const m = useMessages();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const dismissDrag = useSharedValue(0);

  const [phase, setPhase] = useState<WorkspaceTransitionPhase>('closed');
  const [isChatWarm, setIsChatWarm] = useState(false);
  const [overlaySessionKey, setOverlaySessionKey] = useState('');
  const [pillAnchor, setPillAnchor] = useState<LayoutRect | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<LayoutRect | null>(null);

  const pillMeasurerRef = useRef<LayoutMeasurer | null>(null);
  const composerMeasurerRef = useRef<LayoutMeasurer | null>(null);
  const finalizeHandlerRef = useRef<FinalizeAskAiHandler | null>(null);
  const transitionBusyRef = useRef(false);

  const registerPillMeasurer = useCallback((measurer: LayoutMeasurer | null) => {
    pillMeasurerRef.current = measurer;
  }, []);

  const registerComposerMeasurer = useCallback((measurer: LayoutMeasurer | null) => {
    composerMeasurerRef.current = measurer;
  }, []);

  const registerFinalizeHandler = useCallback((handler: FinalizeAskAiHandler | null) => {
    finalizeHandlerRef.current = handler;
  }, []);

  const runFinalize = useCallback(() => {
    requestIdleCallback(() => {
      finalizeHandlerRef.current?.();
    });
  }, []);

  const announce = useCallback((message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const handleOpenSettled = useCallback(() => {
    setPhase('open');
    transitionBusyRef.current = false;
    hapticAskAiSettle();
    announce(m.chat.overlayOpenedAnnouncement);
    runFinalize();
  }, [announce, m.chat.overlayOpenedAnnouncement, runFinalize]);

  const handleCloseSettled = useCallback(() => {
    setPhase('closed');
    setPillAnchor(null);
    setComposerAnchor(null);
    dismissDrag.value = 0;
    transitionBusyRef.current = false;
    hapticAskAiDismiss();
    announce(m.chat.overlayClosedAnnouncement);
    onClosed?.();
  }, [announce, dismissDrag, m.chat.overlayClosedAnnouncement, onClosed]);

  const notifyComposerAnchor = useCallback((rect: LayoutRect) => {
    setComposerAnchor(rect);
  }, []);

  const openAskAi = useCallback(async (sessionKey: string) => {
    if (transitionBusyRef.current || phase === 'open' || phase === 'opening') return;
    transitionBusyRef.current = true;
    hapticAskAiPress();

    setOverlaySessionKey(sessionKey);

    const pillRect = await pillMeasurerRef.current?.();
    setPillAnchor(pillRect ?? null);
    setComposerAnchor(null);
    dismissDrag.value = 0;
    setIsChatWarm(true);
    setPhase('opening');

    if (reducedMotion) {
      progress.value = 1;
      handleOpenSettled();
      return;
    }

    progress.value = withSpring(1, motion.spring.open, (finished) => {
      if (!finished) return;
      scheduleOnRN(handleOpenSettled);
    });
  }, [
    dismissDrag,
    handleOpenSettled,
    phase,
    progress,
    reducedMotion,
  ]);

  const closeAskAi = useCallback(() => {
    if (transitionBusyRef.current || phase === 'closed' || phase === 'closing') return;
    transitionBusyRef.current = true;
    hapticAskAiPress();
    setPhase('closing');
    dismissDrag.value = 0;

    void pillMeasurerRef.current?.().then((rect) => {
      if (rect) setPillAnchor(rect);
    });

    if (reducedMotion) {
      progress.value = 0;
      handleCloseSettled();
      return;
    }

    progress.value = withSpring(0, motion.spring.close, (finished) => {
      if (!finished) return;
      scheduleOnRN(handleCloseSettled);
    });
  }, [dismissDrag, handleCloseSettled, phase, progress, reducedMotion]);

  const completeInteractiveDismiss = useCallback(() => {
    closeAskAi();
  }, [closeAskAi]);

  const cancelInteractiveDismiss = useCallback(() => {
    if (reducedMotion) {
      dismissDrag.value = 0;
      return;
    }
    dismissDrag.value = withSpring(0, motion.spring.dismissSnap);
  }, [dismissDrag, reducedMotion]);

  const setDismissDragFraction = useCallback(
    (fraction: number) => {
      dismissDrag.value = Math.max(0, Math.min(motion.dismiss.maxDragFraction, fraction));
    },
    [dismissDrag],
  );

  const value = useMemo(
    () => ({
      phase,
      progress,
      dismissDrag,
      isChatWarm,
      overlaySessionKey,
      pillAnchor,
      composerAnchor,
      registerPillMeasurer,
      registerComposerMeasurer,
      registerFinalizeHandler,
      notifyComposerAnchor,
      openAskAi,
      closeAskAi,
      completeInteractiveDismiss,
      cancelInteractiveDismiss,
      setDismissDragFraction,
    }),
    [
      cancelInteractiveDismiss,
      closeAskAi,
      completeInteractiveDismiss,
      composerAnchor,
      isChatWarm,
      overlaySessionKey,
      notifyComposerAnchor,
      openAskAi,
      phase,
      pillAnchor,
      progress,
      dismissDrag,
      registerComposerMeasurer,
      registerFinalizeHandler,
      registerPillMeasurer,
      setDismissDragFraction,
    ],
  );

  return (
    <WorkspaceTransitionContext.Provider value={value}>
      {children}
    </WorkspaceTransitionContext.Provider>
  );
}

export function useWorkspaceTransition(): WorkspaceTransitionContextValue {
  const ctx = useContext(WorkspaceTransitionContext);
  if (!ctx) {
    throw new Error('useWorkspaceTransition must be used within WorkspaceTransitionProvider');
  }
  return ctx;
}

export function useOptionalWorkspaceTransition(): WorkspaceTransitionContextValue | null {
  return useContext(WorkspaceTransitionContext);
}
