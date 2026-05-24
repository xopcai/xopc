import { colors } from '../../utils/colors.js';
import type { CheckResult, CheckStatus } from './types.js';

const STATUS_ICONS: Record<CheckStatus, string> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
  skip: '–',
};

function statusColor(status: CheckStatus, text: string): string {
  switch (status) {
    case 'pass':
      return colors.green(text);
    case 'warn':
      return colors.yellow(text);
    case 'fail':
      return colors.red(text);
    default:
      return colors.gray(text);
  }
}

export function formatCheckLine(result: CheckResult): string {
  const icon = STATUS_ICONS[result.status];
  const fixed = result.fixed ? ' ' + colors.cyan('[fixed]') : '';
  return `  ${statusColor(result.status, icon)} ${result.label}: ${result.message}${fixed}`;
}

export function formatHints(hints: string[]): string[] {
  return hints.map((h) => `    ${colors.gray('→')} ${h}`);
}

export function printSummary(results: CheckResult[]): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  const warnings = results.filter((r) => r.status === 'warn').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  console.log('');
  console.log(
    colors.bold(
      `${passed} passed, ${warnings} warnings, ${failed} failed` +
        (skipped ? `, ${skipped} skipped` : ''),
    ),
  );
}

export function printResults(results: CheckResult[], opts?: { security?: boolean }): void {
  console.log('');
  console.log(colors.bold(opts?.security ? 'xopc doctor --security' : 'xopc doctor'));
  console.log('');
  for (const r of results) {
    console.log(formatCheckLine(r));
    if (opts?.security && r.findings?.length) {
      for (const finding of r.findings) {
        const icon = finding.severity === 'critical' ? '✗' : finding.severity === 'warn' ? '⚠' : '·';
        const colored = statusColor(
          finding.severity === 'critical' ? 'fail' : finding.severity === 'warn' ? 'warn' : 'pass',
          icon,
        );
        console.log(`    ${colored} ${colors.bold(finding.checkId)} ${finding.title}`);
        console.log(`      ${colors.gray(finding.detail)}`);
        if (finding.remediation) {
          console.log(`      ${colors.gray('→')} ${finding.remediation}`);
        }
      }
    } else {
      for (const line of formatHints(r.hints)) {
        console.log(line);
      }
    }
  }
  printSummary(results);
  console.log('');
}

export function printJsonResults(results: CheckResult[]): void {
  const ok = results.every((r) => r.status !== 'fail');
  const payload = {
    ok,
    checks: results.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      message: r.message,
      hints: r.hints,
      fixed: r.fixed ?? false,
      ...(r.findings ? { findings: r.findings } : {}),
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
}
