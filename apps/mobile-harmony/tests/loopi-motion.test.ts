import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XopcLoopiMotion, XopcLoopiPose } from '../entry/src/main/ets/common/loopiMotion';

describe('native Loopi motion', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('remains static when reduced motion, background or page visibility disables it', () => {
    const emit = vi.fn();
    const motion = new XopcLoopiMotion(emit);
    motion.update(false, false, 'listen');
    motion.greet();
    vi.advanceTimersByTime(60_000);
    expect(emit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('breathes and blinks repeatedly without JS frame loops', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const poses: XopcLoopiPose[] = [];
    const motion = new XopcLoopiMotion((pose) => { poses.push(pose); });
    motion.update(true, false, 'listen');
    expect(poses).toHaveLength(1);
    vi.advanceTimersByTime(120);
    expect(poses.at(-1)?.lift).toBeLessThan(0);
    vi.advanceTimersByTime(1400);
    expect(poses.at(-1)?.eyeOpen).toBeLessThan(0.2);
    vi.advanceTimersByTime(140);
    expect(poses.at(-1)?.eyeOpen).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(poses.length).toBeGreaterThan(7);
    expect(poses.length).toBeLessThan(20);
    motion.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('plays a single dock response, then leaves no timer', () => {
    const emit = vi.fn();
    const motion = new XopcLoopiMotion(emit);
    motion.update(true, true, 'listen');
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
    const count = emit.mock.calls.length;
    motion.update(true, true, 'listen');
    vi.advanceTimersByTime(5000);
    expect(emit).toHaveBeenCalledTimes(count);
    motion.update(false, true, 'listen');
    motion.update(true, true, 'listen');
    vi.advanceTimersByTime(1000);
    expect(emit.mock.calls.length).toBeGreaterThan(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels every pending blink and resets immediately when disabled', () => {
    const emit = vi.fn();
    const motion = new XopcLoopiMotion(emit);
    motion.update(true, false, 'work');
    vi.advanceTimersByTime(1520);
    motion.update(false, false, 'work');
    expect(emit).toHaveBeenLastCalledWith(new XopcLoopiPose(), 0);
    expect(vi.getTimerCount()).toBe(0);
    const count = emit.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    expect(emit).toHaveBeenCalledTimes(count);
  });

  it('restarts from neutral after foregrounding instead of replaying missed frames', () => {
    const emit = vi.fn();
    const motion = new XopcLoopiMotion(emit);
    motion.update(true, false, 'listen');
    vi.advanceTimersByTime(120);
    motion.update(false, false, 'listen');
    vi.advanceTimersByTime(60_000);
    motion.update(true, false, 'listen');
    expect(emit).toHaveBeenLastCalledWith(new XopcLoopiPose(), 0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('uses real work and care moods, without creating a success state', () => {
    const emit = vi.fn();
    const motion = new XopcLoopiMotion(emit);
    motion.update(true, false, 'work');
    vi.advanceTimersByTime(120);
    expect(emit.mock.calls.at(-1)?.[0].gaze).toBe(2);
    motion.update(true, false, 'care');
    vi.advanceTimersByTime(120);
    expect(emit.mock.calls.at(-1)?.[0].lift).toBe(-1.5);
  });

  it('coalesces repeated greetings and resumes the idle cycle', () => {
    const emit = vi.fn();
    const motion = new XopcLoopiMotion(emit);
    motion.update(true, false, 'listen');
    for (let i = 0; i < 10; i++) motion.greet();
    expect(vi.getTimerCount()).toBe(2);
    expect(emit.mock.calls.at(-1)?.[0].eyeOpen).toBe(0.25);
    vi.advanceTimersByTime(2100);
    expect(emit.mock.calls.at(-1)?.[0].eyeOpen).toBe(1);
    motion.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never emits after unmount', () => {
    const emit = vi.fn();
    const motion = new XopcLoopiMotion(emit);
    motion.update(true, false, 'listen');
    motion.dispose();
    const count = emit.mock.calls.length;
    motion.greet();
    vi.advanceTimersByTime(60_000);
    expect(emit).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });
});
