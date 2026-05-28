import { describe, expect, it } from 'vitest';

import {
  generateMousePath,
  generateScrollPlan,
  generateTypingPlan,
  resolveHumanConfig,
} from '../humanize.js';

describe('resolveHumanConfig', () => {
  it('default preset resolves', () => {
    const cfg = resolveHumanConfig('default');
    expect(cfg.mouseMinSteps).toBeGreaterThan(0);
    expect(cfg.mouseMaxSteps).toBeGreaterThan(cfg.mouseMinSteps);
    expect(cfg.typingDelayMs).toBeGreaterThan(0);
  });

  it('careful preset has slower timing than default', () => {
    const careful = resolveHumanConfig('careful');
    const dflt = resolveHumanConfig('default');
    expect(careful.typingDelayMs).toBeGreaterThanOrEqual(dflt.typingDelayMs);
    expect(careful.clickAimDelayMs[0]).toBeGreaterThanOrEqual(dflt.clickAimDelayMs[0]);
  });
});

describe('generateMousePath', () => {
  it('produces multiple points', () => {
    const cfg = resolveHumanConfig('default');
    const path = generateMousePath({ x: 0, y: 0 }, { x: 500, y: 300 }, cfg);
    expect(path.length).toBeGreaterThanOrEqual(10);
  });

  it('path is not a straight line', () => {
    const cfg = resolveHumanConfig('default');
    let maxDeviation = 0;
    for (let trial = 0; trial < 5; trial++) {
      const path = generateMousePath({ x: 0, y: 0 }, { x: 500, y: 0 }, cfg);
      const deviation = Math.max(...path.map((p) => Math.abs(p.y)));
      if (deviation > maxDeviation) maxDeviation = deviation;
    }
    expect(maxDeviation).toBeGreaterThan(0.5);
  });

  it('ends near the target', () => {
    const cfg = resolveHumanConfig('default');
    const path = generateMousePath({ x: 0, y: 0 }, { x: 200, y: 100 }, cfg);
    // Last point or second-to-last (before overshoot correction) should be near target
    const last = path[path.length - 1];
    // Allow generous tolerance due to wobble and overshoot
    expect(Math.abs(last.x - 200)).toBeLessThan(30);
    expect(Math.abs(last.y - 100)).toBeLessThan(30);
  });
});

describe('generateTypingPlan', () => {
  it('has correct number of char actions', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateTypingPlan('hello', cfg);
    const charCount = plan.filter((a) => a.kind === 'char').length;
    expect(charCount).toBe(5);
  });

  it('has delays between characters', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateTypingPlan('hello', cfg);
    const delayCount = plan.filter((a) => a.kind === 'delay' || a.kind === 'pause').length;
    // At least one delay between each pair of characters
    expect(delayCount).toBeGreaterThanOrEqual(4);
  });

  it('handles empty string', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateTypingPlan('', cfg);
    expect(plan).toHaveLength(0);
  });

  it('handles single character', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateTypingPlan('x', cfg);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('char');
  });

  it('handles unicode characters', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateTypingPlan('你好', cfg);
    const charCount = plan.filter((a) => a.kind === 'char').length;
    expect(charCount).toBe(2);
  });
});

describe('generateScrollPlan', () => {
  it('positive delta produces mostly positive wheel events', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateScrollPlan(600, cfg);
    const wheels = plan.filter((a): a is Extract<typeof a, { kind: 'wheel' }> => a.kind === 'wheel');
    expect(wheels.length).toBeGreaterThan(0);
    const positiveCount = wheels.filter((w) => w.deltaY > 0).length;
    const negativeCount = wheels.filter((w) => w.deltaY < 0).length;
    expect(positiveCount).toBeGreaterThan(negativeCount);
  });

  it('negative delta produces mostly negative wheel events', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateScrollPlan(-400, cfg);
    const wheels = plan.filter((a): a is Extract<typeof a, { kind: 'wheel' }> => a.kind === 'wheel');
    expect(wheels.length).toBeGreaterThan(0);
    const negativeCount = wheels.filter((w) => w.deltaY < 0).length;
    const positiveCount = wheels.filter((w) => w.deltaY > 0).length;
    expect(negativeCount).toBeGreaterThan(positiveCount);
  });

  it('includes pauses between wheel events', () => {
    const cfg = resolveHumanConfig('default');
    const plan = generateScrollPlan(500, cfg);
    const pauseCount = plan.filter((a) => a.kind === 'pause').length;
    expect(pauseCount).toBeGreaterThan(0);
  });
});
