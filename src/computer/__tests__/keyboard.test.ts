import { describe, expect, it } from 'vitest';
import { normalizeComputerKeys } from '../keyboard.js';

describe('computer key normalization', () => {
  it('maps common modifier and navigation aliases to native keys', () => {
    expect(normalizeComputerKeys(['Meta', 'Option', 'F'])).toEqual(['cmd', 'alt', 'f']);
    expect(normalizeComputerKeys(['Super', 'ArrowDown'])).toEqual(['cmd', 'down']);
  });
  it.each([['cmd+alt+f'], ['f', 'cmd'], ['cmd', 'unknown'], []])('rejects malformed combinations %j', (...keys) => {
    expect(() => normalizeComputerKeys(keys)).toThrow('COMPUTER_KEY_NOT_SUPPORTED');
  });
  it.each(['win32', 'linux'] as const)('preserves destructive key direction on %s', platform => {
    expect(normalizeComputerKeys(['Control', 'Backspace'], platform)).toEqual(['ctrl', 'backspace']);
    expect(normalizeComputerKeys(['Delete'], platform)).toEqual(['delete']);
    for (const modifier of ['cmd', 'Meta', 'Super', 'fn']) {
      expect(() => normalizeComputerKeys([modifier, 'a'], platform)).toThrow('COMPUTER_KEY_NOT_SUPPORTED');
    }
  });
});
