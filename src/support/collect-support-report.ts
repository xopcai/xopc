import { homedir } from 'node:os';

import type { CheckResult, DoctorContext } from '../cli/commands/doctor/types.js';
import { collectDoctorResults } from '../cli/commands/doctor/flow.js';
import { resolveConfigPath } from '../config/paths.js';
import { resolveStateDir } from '../config/paths-state.js';
import { PACKAGE_VERSION } from '../package-version.js';
import type { LogEntry, LogQuery } from '../utils/logger/types.js';
import { queryLogs } from '../utils/logger/log-store.js';
import { SupportRedactor } from './redact-support-report.js';
import type {
  SupportDoctorCheck,
  SupportLogEntry,
  SupportReport,
  SupportReportInput,
  SupportRuntimeSnapshot,
} from './types.js';

const LOG_WINDOW_MS = 5 * 60 * 1_000;
const MAX_OCCURRED_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_LOGS = 100;

export type SupportReportCollectorDeps = {
  now?: () => Date;
  collectDoctor?: (context: DoctorContext) => Promise<CheckResult[]>;
  queryLogs?: (query: LogQuery) => Promise<LogEntry[]>;
  runtime?: SupportRuntimeSnapshot;
  paths?: { configPath?: string; homeDir?: string; stateDir?: string; workspaceDir?: string };
};

function occurredAt(input: string | undefined, now: Date): Date {
  const parsed = input ? new Date(input) : now;
  if (Number.isNaN(parsed.getTime())) return now;
  const timestamp = Math.min(now.getTime(), Math.max(now.getTime() - MAX_OCCURRED_AGE_MS, parsed.getTime()));
  return new Date(timestamp);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sanitizeDoctorCheck(check: CheckResult, redactor: SupportRedactor): SupportDoctorCheck {
  return {
    id: check.id,
    label: redactor.text(check.label, 500) ?? '',
    status: check.status,
    message: redactor.text(check.message, 2_000) ?? '',
    hints: check.hints.slice(0, 10).map((hint) => redactor.text(hint, 2_000) ?? ''),
  };
}

function sanitizeLogEntry(entry: LogEntry, redactor: SupportRedactor): SupportLogEntry {
  redactor.addIdentifier(entry.requestId, 'request');
  redactor.addIdentifier(entry.sessionKey, 'session');
  redactor.addIdentifier(entry.sessionId, 'session');
  const meta = asRecord(entry.meta);
  const error = asRecord(entry.err) ?? asRecord(meta?.err);
  const phase = typeof entry.phase === 'string'
    ? entry.phase
    : typeof meta?.phase === 'string'
      ? meta.phase
      : undefined;
  const sanitizedError = error
    ? {
        name: redactor.text(typeof error.name === 'string' ? error.name : undefined, 300),
        message: redactor.text(typeof error.message === 'string' ? error.message : undefined, 2_000),
        stack: redactor.text(typeof error.stack === 'string' ? error.stack : undefined, 6_000),
      }
    : undefined;

  return {
    timestamp: entry.timestamp,
    level: entry.level,
    message: redactor.text(entry.message, 4_000) ?? '',
    module: redactor.text(entry.module, 300),
    phase: redactor.text(phase, 300),
    requestId: redactor.identifier(entry.requestId, 'request'),
    sessionId: redactor.identifier(entry.sessionId, 'session'),
    ...(sanitizedError && Object.values(sanitizedError).some(Boolean) ? { error: sanitizedError } : {}),
  };
}

async function collectRelevantLogs(params: {
  input: SupportReportInput;
  from: Date;
  to: Date;
  query: (query: LogQuery) => Promise<LogEntry[]>;
}): Promise<LogEntry[]> {
  const base: LogQuery = {
    levels: ['warn', 'error', 'fatal'],
    from: params.from.toISOString(),
    to: params.to.toISOString(),
    limit: MAX_LOGS,
    order: 'asc',
  };
  if (params.input.requestId) {
    const logs = await params.query({ ...base, requestId: params.input.requestId });
    if (logs.length > 0) return logs;
  }
  if (params.input.sessionKey) {
    const logs = await params.query({ ...base, sessionKey: params.input.sessionKey });
    if (logs.length > 0) return logs;
  }
  if (params.input.requestId || params.input.sessionKey) return [];
  return params.query(base);
}

function codeBlock(value: string): string {
  return value.replace(/```/g, '``\u200b`');
}

function formatMarkdown(report: Omit<SupportReport, 'markdown'>): string {
  const relevantChecks = report.doctor.filter((check) => check.status !== 'pass');
  const lines = [
    `# ${report.title}`,
    '',
    '## 问题描述',
    '',
    report.problem,
  ];
  if (report.reproduction) lines.push('', '## 复现步骤', '', report.reproduction);
  if (report.expected) lines.push('', '## 期望结果', '', report.expected);
  lines.push(
    '',
    '## 环境信息',
    '',
    `- xopc: ${report.environment.xopcVersion}`,
    `- Node.js: ${report.environment.nodeVersion}`,
    `- 系统: ${report.environment.platform}-${report.environment.arch}`,
    `- 问题时间: ${report.occurredAt}`,
    `- 采集时间: ${report.capturedAt}`,
  );
  if (report.environment.surface) lines.push(`- 入口: ${report.environment.surface}`);
  if (report.environment.currentPage) lines.push(`- 页面: ${report.environment.currentPage}`);
  if (report.runtime?.gatewayStatus) lines.push(`- Gateway: ${report.runtime.gatewayStatus}`);

  lines.push('', '## Doctor 结果', '');
  if (relevantChecks.length === 0) {
    lines.push('- 未发现警告或失败项。');
  } else {
    for (const check of relevantChecks) {
      lines.push(`- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`);
      for (const hint of check.hints) lines.push(`  - ${hint}`);
    }
  }

  lines.push('', '## 相关日志', '');
  if (report.logs.length === 0) {
    lines.push('指定时间范围内没有匹配的 warn/error/fatal 日志。');
  } else {
    lines.push('```text');
    for (const entry of report.logs) {
      const context = [entry.module, entry.phase].filter(Boolean).join('/');
      lines.push(codeBlock(`[${entry.timestamp}] ${entry.level.toUpperCase()}${context ? ` ${context}` : ''} ${entry.message}`));
      if (entry.error?.message && entry.error.message !== entry.message) {
        lines.push(codeBlock(`  ${entry.error.name ? `${entry.error.name}: ` : ''}${entry.error.message}`));
      }
    }
    lines.push('```');
  }
  if (report.rendererError) {
    lines.push('', '## 前端错误', '', '```text', codeBlock(report.rendererError), '```');
  }
  lines.push(
    '',
    '## 隐私说明',
    '',
    `报告已执行自动脱敏，共替换 ${report.redaction.replacements} 处敏感标识或路径；未包含配置原文、凭据、数据库或会话正文。`,
  );
  return lines.join('\n');
}

function titleFromProblem(problem: string): string {
  const firstLine = problem.split(/\r?\n/, 1)[0]?.trim() || 'xopc 使用问题';
  return `[Bug] ${firstLine.slice(0, 80)}`;
}

export async function collectSupportReport(
  input: SupportReportInput,
  deps: SupportReportCollectorDeps = {},
): Promise<SupportReport> {
  const now = deps.now?.() ?? new Date();
  const issueTime = occurredAt(input.occurredAt, now);
  const from = new Date(issueTime.getTime() - LOG_WINDOW_MS);
  const to = new Date(Math.min(now.getTime(), issueTime.getTime() + LOG_WINDOW_MS));
  const stateDir = deps.paths?.stateDir ?? resolveStateDir();
  const redactor = new SupportRedactor({
    homeDir: deps.paths?.homeDir ?? homedir(),
    stateDir,
    workspaceDir: deps.paths?.workspaceDir,
  });
  const doctorContext: DoctorContext = {
    configPath: deps.paths?.configPath ?? resolveConfigPath(),
    stateDir,
    options: { fix: false, json: true, deep: false, security: false },
  };
  redactor.addIdentifier(input.requestId, 'request');
  redactor.addIdentifier(input.sessionKey, 'session');
  let rawLogs: LogEntry[] = [];
  let logCollectionError: string | undefined;
  try {
    rawLogs = await collectRelevantLogs({ input, from, to, query: deps.queryLogs ?? queryLogs });
  } catch (error) {
    logCollectionError = error instanceof Error ? error.message : String(error);
  }
  let doctorResults: CheckResult[];
  try {
    doctorResults = await (deps.collectDoctor ?? collectDoctorResults)(doctorContext);
  } catch (error) {
    doctorResults = [{
      id: 'support-doctor-collection',
      label: 'Doctor collection',
      status: 'warn',
      message: error instanceof Error ? error.message : String(error),
      hints: [],
    }];
  }
  if (logCollectionError) {
    doctorResults.push({
      id: 'support-log-collection',
      label: 'Log collection',
      status: 'warn',
      message: logCollectionError,
      hints: [],
    });
  }
  const problem = redactor.text(input.problem, 10_000) ?? '';
  const base: Omit<SupportReport, 'markdown'> = {
    schemaVersion: 1,
    title: titleFromProblem(problem),
    capturedAt: now.toISOString(),
    occurredAt: issueTime.toISOString(),
    problem,
    expected: redactor.text(input.expected, 5_000),
    reproduction: redactor.text(input.reproduction, 10_000),
    environment: {
      xopcVersion: PACKAGE_VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      surface: input.clientContext?.surface,
      currentPage: redactor.text(input.clientContext?.currentPage, 2_000),
      userAgent: redactor.text(input.clientContext?.userAgent, 2_000),
    },
    runtime: deps.runtime,
    rendererError: redactor.text(input.clientContext?.rendererError, 20_000),
    doctor: doctorResults.map((check) => sanitizeDoctorCheck(check, redactor)),
    logs: rawLogs.map((entry) => sanitizeLogEntry(entry, redactor)),
    logWindow: { from: from.toISOString(), to: to.toISOString() },
    redaction: { replacements: 0 },
  };
  base.redaction.replacements = redactor.replacements;
  return { ...base, markdown: formatMarkdown(base) };
}
