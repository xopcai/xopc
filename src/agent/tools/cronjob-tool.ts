// Agent tool for managing scheduled cron jobs (CronService-backed)
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { CronService } from '../../cron/index.js';
import { describeSchedule } from '../../cron/schedule.js';
import { getCronPayloadText } from '../../cron/job-content.js';
import type { CronDelivery, CronPayload, CronSchedule, CronJobPatch, JobData, JobExecution } from '../../cron/types.js';

const CRON_THREAT_PATTERNS: Array<[RegExp, string]> = [
  [/ignore\s+(previous|all|above)\s+instructions/i, 'prompt_injection'],
  [/do\s+not\s+tell\s+the\s+user/i, 'deception'],
  [/system\s+prompt\s+override/i, 'sys_prompt_override'],
  [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD)/i, 'exfil_curl'],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc)/i, 'read_secrets'],
  [/rm\s+-rf\s+\//i, 'destructive_rm'],
];

export function scanCronPrompt(prompt: string): string | null {
  for (const [pattern, id] of CRON_THREAT_PATTERNS) {
    if (pattern.test(prompt)) {
      return (
        `Blocked: prompt matches threat pattern '${id}'. ` +
        'Cron prompts must not contain injection or exfiltration payloads.'
      );
    }
  }
  return null;
}

const CronjobSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal('list'),
      Type.Literal('create'),
      Type.Literal('update'),
      Type.Literal('remove'),
      Type.Literal('enable'),
      Type.Literal('disable'),
      Type.Literal('history'),
    ],
    { description: 'Action to perform on cron jobs' },
  ),

  name: Type.Optional(Type.String({ description: 'Human-readable job name' })),
  scheduleKind: Type.Optional(
    Type.Union([Type.Literal('cron'), Type.Literal('at'), Type.Literal('every')], {
      description: 'Schedule kind. Use cronExpr for cron, at for one-time ISO time, everyMs for interval.',
    }),
  ),
  cronExpr: Type.Optional(
    Type.String({
      description:
        'Cron schedule expression. Examples:\n' +
        '  "0 9 * * *" = every day at 9:00 AM\n' +
        '  "*/30 * * * *" = every 30 minutes\n' +
        '  "0 9 * * 1-5" = weekdays at 9:00 AM\n' +
        '  "0 0 1 * *" = first day of each month',
    }),
  ),
  at: Type.Optional(Type.String({ description: 'One-time run timestamp as ISO 8601 string.' })),
  everyMs: Type.Optional(Type.Number({ description: 'Fixed interval in milliseconds.' })),
  tz: Type.Optional(Type.String({ description: 'IANA timezone for cronExpr, e.g. Asia/Shanghai.' })),
  message: Type.Optional(
    Type.String({
      description:
        'Instruction for the agent when the job runs (agentTurn payload; typically a fresh session).',
    }),
  ),
  workflowDefinitionId: Type.Optional(
    Type.String({
      description:
        'Workflow definition id for a workflowRun job (mutually exclusive with message on create).',
    }),
  ),
  workflowGoal: Type.Optional(
    Type.String({ description: 'Optional goal override when creating a workflowRun job.' }),
  ),
  workflowInputJson: Type.Optional(
    Type.String({
      description: 'JSON object for workflow input payload (workflowRun create/update).',
    }),
  ),
  goalId: Type.Optional(
    Type.String({
      description:
        'Durable goal id for a goalContinue job (mutually exclusive with message and workflowDefinitionId).',
    }),
  ),
  goalMessage: Type.Optional(
    Type.String({
      description: 'Optional custom continuation message for a goalContinue job.',
    }),
  ),
  waitForCompletion: Type.Optional(
    Type.Boolean({
      description:
        'For workflowRun jobs: when true (default), cron waits for terminal status before succeeding.',
    }),
  ),
  deliveryChannel: Type.Optional(
    Type.String({ description: 'Delivery channel when workflow completes (e.g. telegram).' }),
  ),
  deliveryTo: Type.Optional(
    Type.String({ description: 'Delivery recipient chat id when workflow completes.' }),
  ),
  sessionTarget: Type.Optional(
    Type.Union([Type.Literal('main'), Type.Literal('isolated')], {
      description:
        '"main" uses the main session context; "isolated" (default on create) uses a separate session per run.',
    }),
  ),
  agentId: Type.Optional(
    Type.String({
      description:
        'Agent profile id for isolated jobs (session key). Omit to use the configured default agent (usually `main`).',
    }),
  ),
  workingDirectory: Type.Optional(
    Type.String({
      description:
        'Absolute workspace path on the gateway host for isolated jobs. Omit to use the agent default workspace.',
    }),
  ),

  jobId: Type.Optional(Type.String({ description: 'Job ID (from list output)' })),
});

export type CronjobToolParams = {
  action: 'list' | 'create' | 'update' | 'remove' | 'enable' | 'disable' | 'history';
  name?: string;
  scheduleKind?: 'cron' | 'at' | 'every';
  cronExpr?: string;
  at?: string;
  everyMs?: number;
  tz?: string;
  message?: string;
  workflowDefinitionId?: string;
  workflowGoal?: string;
  workflowInputJson?: string;
  goalId?: string;
  goalMessage?: string;
  waitForCompletion?: boolean;
  deliveryChannel?: string;
  deliveryTo?: string;
  sessionTarget?: 'main' | 'isolated' | 'current';
  agentId?: string;
  workingDirectory?: string;
  jobId?: string;
};

export interface CronjobToolDeps {
  getCronService: () => CronService | undefined;
}

function textResult(text: string): AgentToolResult<{}> {
  return { content: [{ type: 'text', text }], details: {} };
}

function formatJob(job: JobData): string {
  const status = job.enabled ? 'active' : 'disabled';
  const payloadText = getCronPayloadText(job);
  const truncatedPayload =
    payloadText.length > 100 ? `${payloadText.slice(0, 100)}...` : payloadText;
  const payloadLine =
    job.payload.kind === 'workflowRun'
      ? `  Workflow: ${job.payload.definitionId}${job.payload.goal ? ` — ${job.payload.goal}` : ''}`
      : `  Message: ${truncatedPayload}`;

  return [
    `${status} ${job.name ?? '(unnamed)'} (${job.id})`,
    `  Schedule: ${describeSchedule(job.schedule)}`,
    `  Type: ${job.payload.kind}`,
    payloadLine,
    `  Next run: ${job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : 'N/A'}`,
    `  Session: ${job.sessionTarget ?? 'main'}`,
    `  Agent: ${job.agentId?.trim() || '(default)'}`,
    `  Workspace: ${job.workingDirectory?.trim() || '(agent default)'}`,
  ].join('\n');
}

function scheduleFromParams(params: Pick<CronjobToolParams, 'scheduleKind' | 'cronExpr' | 'at' | 'everyMs' | 'tz'>): CronSchedule | undefined {
  const kind = params.scheduleKind;
  if (!kind) return undefined;
  if (kind === 'cron') {
    const expr = params.cronExpr?.trim();
    if (!expr) return undefined;
    return { kind, expr, ...(params.tz?.trim() ? { tz: params.tz.trim() } : {}) };
  }
  if (kind === 'at') {
    const at = params.at?.trim();
    if (!at) return undefined;
    return { kind, at };
  }
  if (!Number.isFinite(params.everyMs) || !params.everyMs || params.everyMs <= 0) return undefined;
  return { kind, everyMs: Math.floor(params.everyMs) };
}

function formatExecution(exec: JobExecution): string {
  const dur = exec.duration != null ? `${(exec.duration / 1000).toFixed(1)}s` : 'N/A';
  const lines = [`[${exec.status}] ${exec.startedAt} (${dur})`];
  if (exec.summary) {
    lines.push(`  Summary: ${exec.summary.slice(0, 200)}`);
  }
  if (exec.error) {
    lines.push(`  Error: ${exec.error.slice(0, 200)}`);
  }
  return lines.join('\n');
}

export function createCronjobTool(deps: CronjobToolDeps): AgentTool {
  return {
    name: 'cronjob',
    label: '⏰ Cronjob',
    description:
      'Manage scheduled tasks (cron jobs) that run automatically.\n\n' +
      'Jobs can run an agent message (agentTurn), a workflow directly (workflowRun), or continue a durable goal (goalContinue).\n\n' +
      'ACTIONS:\n' +
      '- list: Show all scheduled jobs with status and next run time\n' +
      '- create: Create a job (scheduleKind plus exactly one of message, workflowDefinitionId, or goalId)\n' +
      '- update: Change schedule, message, workflow fields, name, sessionTarget, agentId, or workingDirectory (requires jobId)\n' +
      '- remove: Delete a job (requires jobId)\n' +
      '- enable / disable: Toggle a job (requires jobId)\n' +
      '- history: Recent executions for a job (requires jobId)',
    parameters: CronjobSchema,

    async execute(_toolCallId, params: CronjobToolParams, _signal) {
      const cron = deps.getCronService();
      if (!cron) {
        return textResult('Cron service is not available in this environment.');
      }

      try {
        switch (params.action) {
          case 'list': {
            const jobs = await cron.listJobs();
            if (jobs.length === 0) {
              return textResult('No scheduled jobs.');
            }
            const formatted = jobs.map(formatJob).join('\n\n');
            return { content: [{ type: 'text', text: formatted }], details: {} };
          }

          case 'create': {
            const workflowId = params.workflowDefinitionId?.trim();
            const goalId = params.goalId?.trim();
            const hasMessage = Boolean(params.message?.trim());
            const targetCount = [workflowId, goalId, hasMessage ? 'message' : ''].filter(Boolean).length;
            const schedule = scheduleFromParams(params);
            if (!schedule || targetCount !== 1) {
              return textResult(
                'Error: create requires scheduleKind with matching cronExpr/at/everyMs and exactly one of message, workflowDefinitionId, or goalId.',
              );
            }

            if (hasMessage) {
              const scanResult = scanCronPrompt(params.message!);
              if (scanResult) {
                return textResult(`Error: ${scanResult}`);
              }
            }

            let payload: CronPayload;
            let sessionTarget = params.sessionTarget ?? 'isolated';
            let delivery: CronDelivery | undefined;

            if (goalId) {
              payload = {
                kind: 'goalContinue',
                goalId,
                ...(params.goalMessage?.trim() ? { message: params.goalMessage.trim() } : {}),
              };
              sessionTarget = 'isolated';
            } else if (workflowId) {
              let inputEnvelope: { payload: unknown } | undefined;
              if (params.workflowInputJson?.trim()) {
                try {
                  inputEnvelope = { payload: JSON.parse(params.workflowInputJson) as unknown };
                } catch {
                  return textResult('Error: workflowInputJson must be valid JSON.');
                }
              }
              const agentId = params.agentId?.trim() || undefined;
              payload = {
                kind: 'workflowRun',
                definitionId: workflowId,
                ...(params.workflowGoal?.trim() ? { goal: params.workflowGoal.trim() } : {}),
                ...(inputEnvelope ? { inputEnvelope } : {}),
                ...(agentId ? { agentId } : {}),
                ...(params.waitForCompletion === false ? { waitForCompletion: false } : {}),
              };
              sessionTarget = 'isolated';
              if (params.deliveryChannel?.trim() && params.deliveryTo?.trim()) {
                delivery = {
                  mode: 'announce',
                  channel: params.deliveryChannel.trim(),
                  to: params.deliveryTo.trim(),
                };
              }
            } else {
              payload = {
                kind: 'agentTurn',
                message: params.message!.trim(),
              };
            }

            const result = await cron.addJob(schedule, {
              name: params.name?.trim() || undefined,
              sessionTarget,
              ...(delivery ? { delivery } : {}),
              ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
              ...(params.workingDirectory?.trim()
                ? { workingDirectory: params.workingDirectory.trim() }
                : {}),
              payload,
            });

            const kindLabel = goalId ? `goal job (${goalId})` : workflowId ? `workflow job (${workflowId})` : 'job';
            return textResult(
              `Created ${kindLabel}${params.name ? ` "${params.name.trim()}"` : ''} (${result.id})\n` +
                `Schedule: ${describeSchedule(result.schedule)}`,
            );
          }

          case 'update': {
            if (!params.jobId?.trim()) {
              return textResult('Error: update requires jobId.');
            }

            const updates: CronJobPatch = {};
            const nextSchedule = scheduleFromParams(params);
            if (nextSchedule) {
              updates.schedule = nextSchedule;
            }
            if (params.message != null && params.message.trim()) {
              const scanResult = scanCronPrompt(params.message);
              if (scanResult) {
                return textResult(`Error: ${scanResult}`);
              }
              updates.payload = { kind: 'agentTurn', message: params.message.trim() };
            }
            if (params.goalId?.trim()) {
              updates.payload = {
                kind: 'goalContinue',
                goalId: params.goalId.trim(),
                ...(params.goalMessage?.trim() ? { message: params.goalMessage.trim() } : {}),
              };
              updates.sessionTarget = 'isolated';
            }
            if (params.workflowDefinitionId?.trim()) {
              let inputEnvelope: { payload: unknown } | undefined;
              if (params.workflowInputJson?.trim()) {
                try {
                  inputEnvelope = { payload: JSON.parse(params.workflowInputJson) as unknown };
                } catch {
                  return textResult('Error: workflowInputJson must be valid JSON.');
                }
              }
              const agentId = params.agentId?.trim() || undefined;
              updates.payload = {
                kind: 'workflowRun',
                definitionId: params.workflowDefinitionId.trim(),
                ...(params.workflowGoal?.trim() ? { goal: params.workflowGoal.trim() } : {}),
                ...(inputEnvelope ? { inputEnvelope } : {}),
                ...(agentId ? { agentId } : {}),
                ...(params.waitForCompletion === false ? { waitForCompletion: false } : {}),
              };
              updates.sessionTarget = 'isolated';
            }
            if (params.deliveryChannel?.trim() && params.deliveryTo?.trim()) {
              updates.delivery = {
                mode: 'announce',
                channel: params.deliveryChannel.trim(),
                to: params.deliveryTo.trim(),
              };
            }
            if (params.name !== undefined) {
              updates.name = params.name.trim() || undefined;
            }
            if (params.sessionTarget !== undefined) {
              updates.sessionTarget = params.sessionTarget;
            }
            if (params.agentId !== undefined) {
              const t = params.agentId.trim();
              if (t) updates.agentId = t;
            }
            if (params.workingDirectory !== undefined) {
              const t = params.workingDirectory.trim();
              if (t) updates.workingDirectory = t;
            }

            if (Object.keys(updates).length === 0) {
              return textResult(
                'Error: update requires at least one of scheduleKind, message, workflowDefinitionId, name, sessionTarget, agentId, workingDirectory, deliveryChannel/deliveryTo.',
              );
            }

            const success = await cron.updateJob(params.jobId.trim(), updates);
            return textResult(
              success ? `Updated job ${params.jobId.trim()}.` : `Job ${params.jobId.trim()} not found.`,
            );
          }

          case 'remove': {
            if (!params.jobId?.trim()) {
              return textResult('Error: remove requires jobId.');
            }
            const removed = await cron.removeJob(params.jobId.trim());
            return textResult(
              removed ? `Removed job ${params.jobId.trim()}.` : `Job ${params.jobId.trim()} not found.`,
            );
          }

          case 'disable': {
            if (!params.jobId?.trim()) {
              return textResult('Error: disable requires jobId.');
            }
            const toggled = await cron.toggleJob(params.jobId.trim(), false);
            return textResult(
              toggled ? `Disabled job ${params.jobId.trim()}.` : `Job ${params.jobId.trim()} not found.`,
            );
          }

          case 'enable': {
            if (!params.jobId?.trim()) {
              return textResult('Error: enable requires jobId.');
            }
            const toggled = await cron.toggleJob(params.jobId.trim(), true);
            return textResult(
              toggled ? `Enabled job ${params.jobId.trim()}.` : `Job ${params.jobId.trim()} not found.`,
            );
          }

          case 'history': {
            if (!params.jobId?.trim()) {
              return textResult('Error: history requires jobId.');
            }
            const history = await cron.getJobHistory(params.jobId.trim(), 5);
            if (history.length === 0) {
              return textResult(`No execution history for job ${params.jobId.trim()}.`);
            }
            const formatted = history.map(formatExecution).join('\n\n');
            return textResult(formatted);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`Error: ${message}`);
      }
    },
  } as any;
}
