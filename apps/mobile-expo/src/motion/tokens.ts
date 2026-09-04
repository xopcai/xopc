import { Easing } from 'react-native-reanimated';

/**
 * Shared motion language. Durations stay short enough that feedback feels
 * immediate; the longer workspace values preserve the spatial Ask AI reveal.
 */
export const motion = {
  duration: {
    press: 80,
    quick: 140,
    standard: 220,
    ambient: 600,
    open: 320,
    close: 260,
    reduced: 180,
    staggerHeader: 120,
    staggerBody: 200,
    staggerComposer: 280,
  },
  spring: {
    settle: { damping: 24, stiffness: 300, mass: 0.82 },
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
