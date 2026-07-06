import { Easing } from 'react-native-reanimated';

/** Workspace Ask AI overlay motion tokens. */
export const motion = {
  duration: {
    open: 320,
    close: 260,
    reduced: 180,
    staggerHeader: 120,
    staggerBody: 200,
    staggerComposer: 280,
  },
  spring: {
    open: { damping: 22, stiffness: 240, mass: 0.9 },
    close: { damping: 24, stiffness: 280, mass: 0.85 },
    dismissSnap: { damping: 20, stiffness: 300, mass: 0.8 },
  },
  easing: {
    enter: Easing.bezier(0.2, 0, 0, 1),
    exit: Easing.bezier(0.4, 0, 1, 1),
    hero: Easing.bezier(0.25, 0.1, 0.25, 1),
  },
  home: {
    scaleClosed: 1,
    scaleOpen: 0.96,
    opacityOpen: 0.55,
  },
  dismiss: {
    completeProgress: 0.38,
    velocityThreshold: 900,
    maxDragFraction: 0.42,
  },
  hero: {
    borderRadiusFrom: 22,
    borderRadiusTo: 22,
    revealComposerAt: 0.88,
  },
} as const;
