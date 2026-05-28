/**
 * Human-like interaction primitives for browser automation.
 *
 * Implements Bezier mouse movement, humanized clicking, per-character typing
 * with random delays, and wheel-based scrolling with acceleration/deceleration.
 *
 * Ported from brocli's human.rs — all input is dispatched via CDP Input domain
 * through Playwright's CDPSession, bypassing Playwright's high-level API to
 * produce more realistic event patterns.
 */

import type { CDPSession, Page } from 'playwright-core';

// ── Configuration ───────────────────────────────────────────────────────────

/** All tunable parameters for human-like behavior. */
export interface HumanConfig {
  // Keyboard
  typingDelayMs: number;
  typingDelaySpreadMs: number;
  typingPauseChance: number;
  typingPauseRangeMs: [number, number];
  keyHoldMs: [number, number];

  // Mouse movement
  mouseStepsDivisor: number;
  mouseMinSteps: number;
  mouseMaxSteps: number;
  mouseWobbleMax: number;
  mouseOvershootChance: number;
  mouseOvershootPx: [number, number];
  mouseBurstSize: [number, number];
  mouseBurstPauseMs: [number, number];

  // Click
  clickAimDelayMs: [number, number];
  clickHoldMs: [number, number];
  clickInputXRange: [number, number];

  // Scroll
  scrollDeltaBase: [number, number];
  scrollDeltaVariance: number;
  scrollPauseFastMs: [number, number];
  scrollPauseSlowMs: [number, number];
  scrollAccelSteps: [number, number];
  scrollDecelSteps: [number, number];
  scrollOvershootChance: number;
  scrollOvershootPx: [number, number];
  scrollSettleDelayMs: [number, number];

  // Initial cursor
  initialCursorX: [number, number];
  initialCursorY: [number, number];
}

export type HumanPreset = 'default' | 'careful';

const DEFAULT_CONFIG: HumanConfig = {
  typingDelayMs: 70,
  typingDelaySpreadMs: 40,
  typingPauseChance: 0.1,
  typingPauseRangeMs: [400, 1000],
  keyHoldMs: [15, 35],

  mouseStepsDivisor: 8,
  mouseMinSteps: 25,
  mouseMaxSteps: 80,
  mouseWobbleMax: 1.5,
  mouseOvershootChance: 0.15,
  mouseOvershootPx: [3, 6],
  mouseBurstSize: [3, 5],
  mouseBurstPauseMs: [8, 18],

  clickAimDelayMs: [60, 140],
  clickHoldMs: [40, 100],
  clickInputXRange: [0.05, 0.30],

  scrollDeltaBase: [80, 130],
  scrollDeltaVariance: 0.2,
  scrollPauseFastMs: [30, 80],
  scrollPauseSlowMs: [80, 200],
  scrollAccelSteps: [2, 3],
  scrollDecelSteps: [2, 3],
  scrollOvershootChance: 0.1,
  scrollOvershootPx: [50, 150],
  scrollSettleDelayMs: [300, 600],

  initialCursorX: [400, 700],
  initialCursorY: [45, 60],
};

const CAREFUL_CONFIG: HumanConfig = {
  ...DEFAULT_CONFIG,
  typingDelayMs: 100,
  typingDelaySpreadMs: 50,
  typingPauseChance: 0.15,
  typingPauseRangeMs: [500, 1200],
  keyHoldMs: [20, 45],

  mouseBurstPauseMs: [12, 25],

  clickAimDelayMs: [80, 200],
  clickHoldMs: [60, 150],

  scrollPauseFastMs: [100, 200],
  scrollPauseSlowMs: [250, 600],
  scrollSettleDelayMs: [400, 800],
};

export function resolveHumanConfig(preset: HumanPreset = 'default'): HumanConfig {
  return preset === 'careful' ? { ...CAREFUL_CONFIG } : { ...DEFAULT_CONFIG };
}

// ── Geometry ────────────────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Random helpers ──────────────────────────────────────────────────────────

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(randRange(min, max + 1));
}

// ── Bezier mouse trajectory ─────────────────────────────────────────────────

function easeInOut(t: number): number {
  return (1 - Math.cos(Math.PI * t)) / 2;
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/** Generate a human-like mouse path from start to end using cubic Bezier with wobble. */
export function generateMousePath(start: Point, end: Point, cfg: HumanConfig): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.min(
    cfg.mouseMaxSteps,
    Math.max(cfg.mouseMinSteps, Math.round(distance / cfg.mouseStepsDivisor)),
  );

  // Control points with randomized offsets for natural curve
  const cp1: Point = {
    x: start.x + dx * randRange(0.2, 0.4) + randRange(-30, 30),
    y: start.y + dy * randRange(0.0, 0.3) + randRange(-30, 30),
  };
  const cp2: Point = {
    x: start.x + dx * randRange(0.6, 0.8) + randRange(-30, 30),
    y: start.y + dy * randRange(0.7, 1.0) + randRange(-30, 30),
  };

  const path: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const raw = i / steps;
    const t = easeInOut(raw);
    const pt = bezier(start, cp1, cp2, end, t);
    // Add wobble
    const wobble = cfg.mouseWobbleMax * (1 - raw); // wobble decreases near target
    pt.x += randRange(-wobble, wobble);
    pt.y += randRange(-wobble, wobble);
    path.push(pt);
  }

  // Optional overshoot + correction
  if (Math.random() < cfg.mouseOvershootChance) {
    const overshootPx = randRange(cfg.mouseOvershootPx[0], cfg.mouseOvershootPx[1]);
    const angle = Math.atan2(dy, dx);
    path.push({
      x: end.x + Math.cos(angle) * overshootPx,
      y: end.y + Math.sin(angle) * overshootPx,
    });
    // Correction back to target
    path.push({ x: end.x + randRange(-1, 1), y: end.y + randRange(-1, 1) });
  }

  return path;
}

// ── Typing plan ─────────────────────────────────────────────────────────────

export type TypeAction =
  | { kind: 'char'; ch: string; holdMs: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'pause'; ms: number };

/** Generate a plan of typing actions for a given text. */
export function generateTypingPlan(text: string, cfg: HumanConfig): TypeAction[] {
  const actions: TypeAction[] = [];
  const chars = [...text];

  for (let i = 0; i < chars.length; i++) {
    const hold = randRange(cfg.keyHoldMs[0], cfg.keyHoldMs[1]);
    actions.push({ kind: 'char', ch: chars[i], holdMs: hold });

    if (i < chars.length - 1) {
      if (Math.random() < cfg.typingPauseChance) {
        const pause = randRange(cfg.typingPauseRangeMs[0], cfg.typingPauseRangeMs[1]);
        actions.push({ kind: 'pause', ms: pause });
      } else {
        const delay = cfg.typingDelayMs + (Math.random() - 0.5) * 2 * cfg.typingDelaySpreadMs;
        actions.push({ kind: 'delay', ms: Math.max(10, delay) });
      }
    }
  }

  return actions;
}

// ── Scroll plan ─────────────────────────────────────────────────────────────

export type ScrollAction =
  | { kind: 'wheel'; deltaY: number }
  | { kind: 'pause'; ms: number };

/** Generate a scroll plan to move totalDelta pixels vertically. */
export function generateScrollPlan(totalDelta: number, cfg: HumanConfig): ScrollAction[] {
  const direction = totalDelta > 0 ? 1 : -1;
  const absDistance = Math.abs(totalDelta);
  const avgDelta = (cfg.scrollDeltaBase[0] + cfg.scrollDeltaBase[1]) / 2;
  const totalClicks = Math.max(3, Math.ceil(absDistance / avgDelta));
  const accelSteps = randInt(cfg.scrollAccelSteps[0], cfg.scrollAccelSteps[1]);
  const decelSteps = randInt(cfg.scrollDecelSteps[0], cfg.scrollDecelSteps[1]);

  const actions: ScrollAction[] = [];
  let scrolled = 0;

  for (let i = 0; i < totalClicks; i++) {
    if (scrolled >= absDistance) break;

    let delta: number;
    let pause: number;

    if (i < accelSteps) {
      delta = randRange(60, 100);
      pause = randRange(cfg.scrollPauseSlowMs[0], cfg.scrollPauseSlowMs[1]);
    } else if (i >= totalClicks - decelSteps) {
      delta = randRange(50, 90);
      pause = randRange(cfg.scrollPauseSlowMs[0], cfg.scrollPauseSlowMs[1]);
    } else {
      delta = randRange(cfg.scrollDeltaBase[0], cfg.scrollDeltaBase[1]);
      pause = randRange(cfg.scrollPauseFastMs[0], cfg.scrollPauseFastMs[1]);
    }

    const variance = 1 + (Math.random() - 0.5) * 2 * cfg.scrollDeltaVariance;
    const finalDelta = Math.round(delta * variance * direction);
    actions.push({ kind: 'wheel', deltaY: finalDelta });
    actions.push({ kind: 'pause', ms: pause });
    scrolled += delta * variance;
  }

  // Optional overshoot + correction
  if (Math.random() < cfg.scrollOvershootChance) {
    const overshoot = Math.round(
      randRange(cfg.scrollOvershootPx[0], cfg.scrollOvershootPx[1]) * direction,
    );
    actions.push({ kind: 'wheel', deltaY: overshoot });
    const settle = randRange(cfg.scrollSettleDelayMs[0], cfg.scrollSettleDelayMs[1]);
    actions.push({ kind: 'pause', ms: settle });
    const correction = Math.round(randRange(40, 80) * -direction);
    actions.push({ kind: 'wheel', deltaY: correction });
  }

  return actions;
}

// ── Click target resolution ─────────────────────────────────────────────────

function clickTarget(bbox: BBox, isInput: boolean, cfg: HumanConfig): Point {
  const x = isInput
    ? bbox.x + bbox.width * randRange(cfg.clickInputXRange[0], cfg.clickInputXRange[1])
    : bbox.x + randRange(bbox.width * 0.15, bbox.width * 0.85);
  const y = bbox.y + randRange(bbox.height * 0.2, bbox.height * 0.8);
  return { x, y };
}

// ── CDP dispatch helpers ────────────────────────────────────────────────────

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, Math.round(ms)));
}

async function ensureCdpSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

async function dispatchMouseMove(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

type CdpMouseEventType = 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';

async function dispatchMouseEvent(
  cdp: CDPSession,
  eventType: CdpMouseEventType,
  x: number,
  y: number,
  clickCount: number,
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: eventType,
    x,
    y,
    button: 'left',
    clickCount,
  });
}

async function dispatchWheel(
  cdp: CDPSession,
  x: number,
  y: number,
  deltaY: number,
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: 0,
    deltaY,
  });
}

async function dispatchChar(cdp: CDPSession, ch: string, holdMs: number): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
  await sleepMs(holdMs);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
}

async function dispatchKey(
  cdp: CDPSession,
  key: string,
  modifiers?: number,
): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    ...(modifiers !== undefined ? { modifiers } : {}),
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    ...(modifiers !== undefined ? { modifiers } : {}),
  });
}

async function executeMousePath(
  cdp: CDPSession,
  path: Point[],
  cfg: HumanConfig,
): Promise<void> {
  const burstSize = randInt(cfg.mouseBurstSize[0], cfg.mouseBurstSize[1]);
  let burstCounter = 0;

  for (const pt of path) {
    await dispatchMouseMove(cdp, pt.x, pt.y);
    burstCounter++;
    if (burstCounter >= burstSize) {
      const pause = randRange(cfg.mouseBurstPauseMs[0], cfg.mouseBurstPauseMs[1]);
      await sleepMs(pause);
      burstCounter = 0;
    }
  }
}

async function getElementBBox(page: Page, selector: string): Promise<BBox> {
  const bbox = await page.locator(selector).boundingBox();
  if (!bbox) {
    throw new Error(`selector not found: ${selector}`);
  }
  return bbox;
}

// ── Public async entry points ───────────────────────────────────────────────

/** Humanized click on a CSS selector. */
export async function humanizedClick(
  page: Page,
  selector: string,
  preset: HumanPreset = 'default',
): Promise<void> {
  const cfg = resolveHumanConfig(preset);
  const cdp = await ensureCdpSession(page);

  try {
    // Initialize cursor at a random starting position
    let cx = randRange(cfg.initialCursorX[0], cfg.initialCursorX[1]);
    let cy = randRange(cfg.initialCursorY[0], cfg.initialCursorY[1]);
    await dispatchMouseMove(cdp, cx, cy);

    // Get element bounding box and compute click target
    const bbox = await getElementBBox(page, selector);
    const target = clickTarget(bbox, false, cfg);

    // Move to target along Bezier path
    const path = generateMousePath({ x: cx, y: cy }, target, cfg);
    await executeMousePath(cdp, path, cfg);
    const last = path[path.length - 1];
    if (last) {
      cx = last.x;
      cy = last.y;
    }

    // Click with aim delay and hold
    await sleepMs(randRange(cfg.clickAimDelayMs[0], cfg.clickAimDelayMs[1]));
    await dispatchMouseEvent(cdp, 'mousePressed', cx, cy, 1);
    await sleepMs(randRange(cfg.clickHoldMs[0], cfg.clickHoldMs[1]));
    await dispatchMouseEvent(cdp, 'mouseReleased', cx, cy, 1);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Humanized fill: click the field, clear, type character by character. */
export async function humanizedFill(
  page: Page,
  selector: string,
  value: string,
  preset: HumanPreset = 'default',
): Promise<void> {
  const cfg = resolveHumanConfig(preset);
  const cdp = await ensureCdpSession(page);

  try {
    // Initialize cursor
    let cx = randRange(cfg.initialCursorX[0], cfg.initialCursorX[1]);
    let cy = randRange(cfg.initialCursorY[0], cfg.initialCursorY[1]);
    await dispatchMouseMove(cdp, cx, cy);

    // Get element bbox and move to it (input-biased left click)
    const bbox = await getElementBBox(page, selector);
    const target = clickTarget(bbox, true, cfg);
    const path = generateMousePath({ x: cx, y: cy }, target, cfg);
    await executeMousePath(cdp, path, cfg);
    const last = path[path.length - 1];
    if (last) {
      cx = last.x;
      cy = last.y;
    }

    // Click to focus
    await sleepMs(randRange(cfg.clickAimDelayMs[0], cfg.clickAimDelayMs[1]));
    await dispatchMouseEvent(cdp, 'mousePressed', cx, cy, 1);
    await sleepMs(randRange(cfg.clickHoldMs[0], cfg.clickHoldMs[1]));
    await dispatchMouseEvent(cdp, 'mouseReleased', cx, cy, 1);
    await sleepMs(100);

    // Select all + delete to clear existing content
    await dispatchKey(cdp, 'a', 8); // 8 = Meta modifier
    await sleepMs(50);
    await dispatchKey(cdp, 'Backspace');
    await sleepMs(80);

    // Type character by character
    const plan = generateTypingPlan(value, cfg);
    for (const action of plan) {
      if (action.kind === 'char') {
        await dispatchChar(cdp, action.ch, action.holdMs);
      } else {
        await sleepMs(action.ms);
      }
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Humanized key press with hold delay. */
export async function humanizedPress(
  page: Page,
  key: string,
  preset: HumanPreset = 'default',
): Promise<void> {
  const cfg = resolveHumanConfig(preset);
  const cdp = await ensureCdpSession(page);

  try {
    const hold = randRange(cfg.keyHoldMs[0], cfg.keyHoldMs[1]);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key });
    await sleepMs(hold);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Humanized scroll by deltaY pixels using wheel events. */
export async function humanizedScroll(
  page: Page,
  deltaY: number,
  preset: HumanPreset = 'default',
): Promise<void> {
  const cfg = resolveHumanConfig(preset);
  const cdp = await ensureCdpSession(page);

  try {
    const cx = randRange(cfg.initialCursorX[0], cfg.initialCursorX[1]);
    const cy = randRange(cfg.initialCursorY[0], cfg.initialCursorY[1]);
    await dispatchMouseMove(cdp, cx, cy);

    const plan = generateScrollPlan(deltaY, cfg);
    for (const action of plan) {
      if (action.kind === 'wheel') {
        await dispatchWheel(cdp, cx, cy, action.deltaY);
      } else {
        await sleepMs(action.ms);
      }
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}
