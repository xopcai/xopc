import { describe, expect, it } from 'vitest';
import { phoneInputEnabled, phonePoint } from '../entry/src/main/ets/common/phoneInteraction.ets';

describe('phone gestures', () => {
  it('excludes contain letterboxes and normalizes only the actual phone image', () => {
    expect(phonePoint(400, 400, 100, 200, 200, 200)).toEqual({ x: 500, y: 500 });
    expect(phonePoint(400, 400, 100, 200, 10, 200)).toBeUndefined();
    expect(phonePoint(400, 400, 100, 200, 100, 0)).toEqual({ x: 0, y: 0 });
    expect(phonePoint(200, 400, 200, 100, 100, 10)).toBeUndefined();
    expect(phonePoint(200, 400, 200, 100, 200, 250)).toEqual({ x: 1000, y: 1000 });
    expect(phonePoint(0, 0, 100, 200, 0, 0)).toBeUndefined();
  });
  it('requires confirmed ownership, visible page and a healthy connection for input', () => {
    expect(phoneInputEnabled(true, false, true, true)).toBe(true);
    expect(phoneInputEnabled(false, false, true, true)).toBe(false);
    expect(phoneInputEnabled(true, true, true, true)).toBe(false);
    expect(phoneInputEnabled(true, false, false, true)).toBe(false);
    expect(phoneInputEnabled(true, false, true, false)).toBe(false);
  });
});
