import {
  parseLocalAppRuntimeMessage,
  type LocalAppAcceptanceResult,
  type LocalAppRuntimeIssue,
} from '@xopcai/gateway-contract';

export { parseLocalAppRuntimeMessage };
export type {
  LocalAppAcceptanceCheck,
  LocalAppAcceptanceResult,
  LocalAppCriteriaResult,
  LocalAppCriteriaScenarioResult,
  LocalAppRuntimeIssue,
  LocalAppRuntimeMessage,
} from '@xopcai/gateway-contract';

export function getLocalAppAcceptanceFailures(result: LocalAppAcceptanceResult | null): string[] {
  return result?.checks.filter((check) => check.status === 'failed').map((check) => check.message) ?? [];
}

export function formatLocalAppRuntimeIssue(issue: LocalAppRuntimeIssue): string {
  const location = issue.filename
    ? ` (${issue.filename}${issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : ''})`
    : '';
  return `${issue.message}${location}`;
}
