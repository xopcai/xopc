import { Easing } from 'react-native-reanimated';

/** Shared motion language for direct, restrained native feedback. */
export const motion = {
  duration: {
    press: 80,
    quick: 140,
    standard: 220,
    ambient: 600,
    reduced: 180,
  },
  spring: {
    settle: { damping: 24, stiffness: 300, mass: 0.82 },
  },
  easing: {
    enter: Easing.bezier(0.2, 0, 0, 1),
    exit: Easing.bezier(0.4, 0, 1, 1),
  },
} as const;
