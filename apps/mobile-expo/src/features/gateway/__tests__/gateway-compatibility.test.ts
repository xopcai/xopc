import { beforeEach, describe, expect, it } from 'vitest';

import {
  readGatewayCompatibilityIssue,
  useGatewayCompatibility,
} from '../gateway-compatibility';

describe('gateway compatibility', () => {
  beforeEach(() => useGatewayCompatibility.getState().clearIssue());

  it('accepts only directional compatibility errors', () => {
    expect(readGatewayCompatibilityIssue('CLIENT_UPDATE_REQUIRED')).toBe('CLIENT_UPDATE_REQUIRED');
    expect(readGatewayCompatibilityIssue('GATEWAY_UPDATE_REQUIRED')).toBe('GATEWAY_UPDATE_REQUIRED');
    expect(readGatewayCompatibilityIssue('UNAUTHORIZED')).toBeNull();
    expect(readGatewayCompatibilityIssue(null)).toBeNull();
  });

  it('keeps the issue until a successful connection clears it', () => {
    useGatewayCompatibility.getState().setIssue('CLIENT_UPDATE_REQUIRED');
    expect(useGatewayCompatibility.getState().issue).toBe('CLIENT_UPDATE_REQUIRED');
    useGatewayCompatibility.getState().clearIssue();
    expect(useGatewayCompatibility.getState().issue).toBeNull();
  });
});
