import { describe, expect, it } from 'vitest';

import {
  parseGatewaySecurityAuditResponse,
  sortSecurityAuditFindings,
} from '../gateway-security-audit-api';

describe('parseGatewaySecurityAuditResponse', () => {
  it('extracts security-audit check with sorted findings', () => {
    const result = parseGatewaySecurityAuditResponse({
      ok: false,
      checks: [
        {
          id: 'other',
          label: 'Other',
          status: 'pass',
          message: 'ignored',
        },
        {
          id: 'security-audit',
          label: 'Security',
          status: 'fail',
          message: '2 critical gateway security issue(s) detected.',
          hints: ['[gateway.auth.none_on_network] Set token auth'],
          findings: [
            {
              checkId: 'gateway.cors.empty_on_network',
              severity: 'critical',
              title: 'Missing CORS',
              detail: 'Network bind without corsOrigins.',
              remediation: 'Set gateway.corsOrigins.',
            },
            {
              checkId: 'gateway.auth.none_on_network',
              severity: 'critical',
              title: 'No auth',
              detail: 'Auth mode is none.',
            },
            {
              checkId: 'gateway.tls.info',
              severity: 'info',
              title: 'TLS note',
              detail: 'Tunnel provides TLS.',
            },
          ],
        },
      ],
    });

    expect(result.status).toBe('fail');
    expect(result.message).toContain('critical');
    expect(result.hints).toHaveLength(1);
    expect(result.findings.map((f) => f.checkId)).toEqual([
      'gateway.auth.none_on_network',
      'gateway.cors.empty_on_network',
      'gateway.tls.info',
    ]);
  });

  it('returns skip when security-audit check is missing', () => {
    const result = parseGatewaySecurityAuditResponse({ ok: true, checks: [] });
    expect(result.status).toBe('skip');
    expect(result.findings).toEqual([]);
  });
});

describe('sortSecurityAuditFindings', () => {
  it('orders critical before warn before info', () => {
    const sorted = sortSecurityAuditFindings([
      { checkId: 'b', severity: 'info', title: 'i', detail: 'd' },
      { checkId: 'a', severity: 'critical', title: 'c', detail: 'd' },
      { checkId: 'c', severity: 'warn', title: 'w', detail: 'd' },
    ]);
    expect(sorted.map((f) => f.severity)).toEqual(['critical', 'warn', 'info']);
  });
});
