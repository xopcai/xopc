import { curves, UIContext } from '@kit.ArkUI';
import { layoutState } from '../service/layoutState';

/** Unified Calm-Intelligence motion timing tokens (milliseconds). */
export const XOPC_MOTION_MICRO_MS: number = 140;
export const XOPC_MOTION_STANDARD_MS: number = 220;
export const XOPC_MOTION_EXIT_MS: number = 180;
export const XOPC_MOTION_PAGER_MS: number = 230;
export const XOPC_MOTION_EMPHASIS_MS: number = 280;
export const XOPC_MOTION_SKELETON_MS: number = 1200;

let cachedStandardCurve: ICurve | undefined = undefined;
let cachedEmphasisSpring: ICurve | undefined = undefined;

export function xopcStandardCurve(): ICurve {
  if (!cachedStandardCurve) {
    cachedStandardCurve = curves.cubicBezierCurve(0.32, 0.72, 0, 1);
  }
  return cachedStandardCurve;
}

export function xopcEmphasisSpring(): ICurve {
  if (!cachedEmphasisSpring) {
    cachedEmphasisSpring = curves.interpolatingSpring(0, 1, 228, 30);
  }
  return cachedEmphasisSpring;
}

export function xopcMotionDuration(durationMs: number, reduceMotion: boolean = layoutState.reduceMotion): number {
  return reduceMotion || durationMs <= 0 ? 0 : durationMs;
}

export function xopcPagerDuration(reduceMotion: boolean = layoutState.reduceMotion): number {
  return xopcMotionDuration(XOPC_MOTION_PAGER_MS, reduceMotion);
}

/** Animates adjacent pager switches only when motion is enabled. */
export function xopcPagerAnimated(reduceMotion: boolean = layoutState.reduceMotion, distance: number = 1): boolean {
  return !reduceMotion && Math.abs(distance) === 1;
}

export function xopcWithMotion(uiContext: UIContext, durationMs: number, curve: Curve | ICurve,
  action: () => void, onFinish?: () => void, reduceMotion: boolean = layoutState.reduceMotion): void {
  if (reduceMotion || durationMs <= 0) {
    action();
    if (onFinish) onFinish();
    return;
  }
  uiContext.animateTo({ duration: durationMs, curve, onFinish }, action);
}

export function xopcRevealTransition(edge: TransitionEdge = TransitionEdge.TOP,
  reduceMotion: boolean = layoutState.reduceMotion): TransitionEffect {
  if (reduceMotion) {
    return TransitionEffect.OPACITY.animation({ duration: 0 });
  }
  return TransitionEffect.OPACITY.combine(TransitionEffect.move(edge))
    .animation({ duration: XOPC_MOTION_STANDARD_MS, curve: xopcStandardCurve() });
}

export function xopcFadeTransition(durationMs: number = XOPC_MOTION_MICRO_MS,
  reduceMotion: boolean = layoutState.reduceMotion): TransitionEffect {
  return TransitionEffect.OPACITY.animation({
    duration: xopcMotionDuration(durationMs, reduceMotion),
    curve: Curve.EaseOut,
  });
}

export function xopcClickEffect(): ClickEffect {
  return { level: ClickEffectLevel.LIGHT, scale: 0.98 };
}
