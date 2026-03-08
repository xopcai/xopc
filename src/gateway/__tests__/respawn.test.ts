import { describe, it, expect } from 'vitest';
import { restartGatewayProcessWithFreshPid } from '../respawn.js';

describe('ProcessRespawn', () => {
  it('should return disabled when XOPCBOT_NO_RESPAWN is set', () => {
    const originalValue = process.env.XOPCBOT_NO_RESPAWN;
    process.env.XOPCBOT_NO_RESPAWN = '1';
    
    try {
      const result = restartGatewayProcessWithFreshPid();
      expect(result.mode).toBe('disabled');
    } finally {
      if (originalValue !== undefined) {
        process.env.XOPCBOT_NO_RESPAWN = originalValue;
      } else {
        delete process.env.XOPCBOT_NO_RESPAWN;
      }
    }
  });

  it('should return supervised when supervisor hint is present', () => {
    const originalValue = process.env.INVOCATION_ID;
    process.env.INVOCATION_ID = 'test-invocation-id';
    
    try {
      const result = restartGatewayProcessWithFreshPid();
      expect(result.mode).toBe('supervised');
    } finally {
      if (originalValue !== undefined) {
        process.env.INVOCATION_ID = originalValue;
      } else {
        delete process.env.INVOCATION_ID;
      }
    }
  });
});
