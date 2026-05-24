import { existsSync, statSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import { collectGatewaySecurityFindings, type SecurityAuditFinding } from '../../../../gateway/security/audit.js';
import type { CheckResult, DoctorContext } from '../types.js';

function collectConfigFileHints(configPath: string): string[] {
  const hints: string[] = [];
  if (process.platform === 'win32') {
    return hints;
  }
  try {
    const st = statSync(configPath);
    const perms = st.mode & 0o777;
    if (perms & 0o077) {
      hints.push('Config file is group/world-readable; consider chmod 600 (contains secrets).');
    }
  } catch {
    /* ignore */
  }
  return hints;
}

function formatFindingHint(finding: SecurityAuditFinding): string {
  const remediation = finding.remediation ?? finding.detail;
  return `[${finding.checkId}] ${remediation}`;
}

function summarizeFindings(findings: SecurityAuditFinding[]): Pick<CheckResult, 'status' | 'message' | 'hints'> {
  const critical = findings.filter((f) => f.severity === 'critical');
  const warns = findings.filter((f) => f.severity === 'warn');
  const infos = findings.filter((f) => f.severity === 'info');

  const hints = [
    ...critical.map(formatFindingHint),
    ...warns.map(formatFindingHint),
    ...infos.map(formatFindingHint),
  ];

  if (critical.length > 0) {
    const startupBlocked = critical.some((f) => f.checkId === 'gateway.runtime_config.blocked');
    return {
      status: 'fail',
      message: startupBlocked
        ? 'Gateway startup would be blocked by security guards (critical).'
        : `${critical.length} critical gateway security issue(s) detected.`,
      hints,
    };
  }

  if (warns.length > 0) {
    return {
      status: 'warn',
      message: `${warns.length} gateway security recommendation(s).`,
      hints,
    };
  }

  if (infos.length > 0) {
    return {
      status: 'pass',
      message: `${infos.length} informational note(s); no critical gateway security issues.`,
      hints,
    };
  }

  return {
    status: 'pass',
    message: 'No critical gateway security issues detected.',
    hints,
  };
}

export async function checkSecurityAudit(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'security-audit',
      label: 'Security',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let cfg: Config;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'security-audit',
      label: 'Security',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const findings = collectGatewaySecurityFindings(cfg);
  const summary = summarizeFindings(findings);
  const fileHints = collectConfigFileHints(ctx.configPath);

  return {
    id: 'security-audit',
    label: 'Security',
    status: fileHints.length > 0 && summary.status === 'pass' ? 'warn' : summary.status,
    message:
      fileHints.length > 0 && summary.status === 'pass'
        ? 'No critical gateway issues; config file permissions could be tighter.'
        : summary.message,
    hints: [...summary.hints, ...fileHints],
    findings,
  };
}
