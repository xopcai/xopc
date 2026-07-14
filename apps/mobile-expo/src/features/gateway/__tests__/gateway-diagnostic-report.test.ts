import { describe, expect, it } from 'vitest';

import { gatewayDiagnosticReport } from '../gateway-diagnostic-report';

describe('gatewayDiagnosticReport', () => {
  it('tells the user to re-pair when credentials are invalid', () => {
    expect(gatewayDiagnosticReport({ kind: 'token-invalid' })).toEqual({
      state: 'token-invalid', action: 're_pair', isBlocking: true,
    });
  });

  it('does not block work when the tunnel is a healthy fallback', () => {
    expect(gatewayDiagnosticReport({ kind: 'degraded-tunnel-only' })).toEqual({
      state: 'degraded-tunnel-only', action: 'continue', isBlocking: false,
    });
  });
});
