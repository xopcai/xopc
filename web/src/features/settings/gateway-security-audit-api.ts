import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type GatewaySecurityAuditSeverity = 'critical' | 'warn' | 'info';

export type GatewaySecurityAuditFinding = {
  checkId: string;
  severity: GatewaySecurityAuditSeverity;
  title: string;
  detail: string;
  remediation?: string;
};

export type GatewaySecurityAuditStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type GatewaySecurityAuditResult = {
  status: GatewaySecurityAuditStatus;
  message: string;
  hints: string[];
  findings: GatewaySecurityAuditFinding[];
};

type DoctorCheckResponse = {
  id: string;
  label: string;
  status: GatewaySecurityAuditStatus;
  message: string;
  hints?: string[];
  findings?: GatewaySecurityAuditFinding[];
};

type DoctorApiResponse = {
  ok?: boolean;
  checks?: DoctorCheckResponse[];
};

const SEVERITY_RANK: Record<GatewaySecurityAuditSeverity, number> = {
  critical: 3,
  warn: 2,
  info: 1,
};

export function gatewaySecurityAuditSwrKey(): string {
  return apiUrl('/api/doctor?security=true');
}

export function sortSecurityAuditFindings(
  findings: GatewaySecurityAuditFinding[],
): GatewaySecurityAuditFinding[] {
  return findings.toSorted(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.checkId.localeCompare(b.checkId),
  );
}

export function parseGatewaySecurityAuditResponse(data: DoctorApiResponse | undefined): GatewaySecurityAuditResult {
  const check = data?.checks?.find((c) => c.id === 'security-audit');
  if (!check) {
    return {
      status: 'skip',
      message: 'Security audit unavailable.',
      hints: [],
      findings: [],
    };
  }

  const findings = sortSecurityAuditFindings(
    (check.findings ?? []).filter(
      (f): f is GatewaySecurityAuditFinding =>
        typeof f.checkId === 'string' &&
        (f.severity === 'critical' || f.severity === 'warn' || f.severity === 'info') &&
        typeof f.title === 'string' &&
        typeof f.detail === 'string',
    ),
  );

  return {
    status: check.status,
    message: check.message,
    hints: Array.isArray(check.hints) ? check.hints.filter((h): h is string => typeof h === 'string') : [],
    findings,
  };
}

export async function fetchGatewaySecurityAudit(): Promise<GatewaySecurityAuditResult> {
  const res = await fetchJson<DoctorApiResponse>(gatewaySecurityAuditSwrKey());
  return parseGatewaySecurityAuditResponse(res);
}
