import { describe, expect, it } from 'vitest';
import { decodeNativeProcessIdentity } from '../native-process-identity.js';
const sample = { pid: 42, start_time: '18446744073709551615', executable: '/private/example/App' };
describe('fresh native process identity', () => {
  it('compares stable samples without exposing executable paths', () => {
    const identity = decodeNativeProcessIdentity(sample, 42);
    expect(identity).toMatch(/^42:kernel:[a-f0-9]{64}$/);
    expect(identity).not.toContain(sample.executable);
    expect(decodeNativeProcessIdentity({ executable: sample.executable, start_time: sample.start_time, pid: 42 }, 42)).toBe(identity);
    expect(decodeNativeProcessIdentity({ ...sample, start_time: '1' }, 42)).not.toBe(identity);
    expect(decodeNativeProcessIdentity({ ...sample, executable: '/other' }, 42)).not.toBe(identity);
  });
  it.each([{ ...sample, pid: 43 }, { ...sample, start_time: '18446744073709551616' },
    { ...sample, start_time: null }, { ...sample, executable: '' }])('refuses mismatched or incomplete proof', data => {
    expect(() => decodeNativeProcessIdentity(data, 42)).toThrow('COMPUTER_DRIVER_INVALID_RESULT');
  });
});
