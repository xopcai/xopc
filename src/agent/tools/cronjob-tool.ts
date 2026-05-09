// Agent tool for managing scheduled cron jobs (CronService-backed)
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { CronService } from '../../cron/index.js';
import type { CronPayload, JobData, JobExecution, JobWithNextRun } from '../../cron/types.js';

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
  schedule: Type.Optional(
    Type.String({
      description:
        'Cron schedule expression. Examples:\n' +
        '  "0 9 * * *" = every day at 9:00 AM\n' +
        '  "*/30 * * * *" = every 30 minutes\n' +
        '  "0 9 * * 1-5" = weekdays at 9:00 AM\n' +
        '  "0 0 1 * *" = first day of each month',
    }),
  ),
  message: Type.Optional(
    Type.String({
      description:
        'Instruction for the agent when the job runs (agentTurn payload; typically a fresh session).',
    }),
  ),
  timezone: Type.Optional(
    Type.String({
      description:
        'IANA timezone (e.g. Asia/Shanghai, America/New_York). Must be one supported by the cron store.',
    }),
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
  schedule?: string;
  message?: string;
  timezone?: string;
  sessionTarget?: 'main' | 'isolated';
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

function formatJob(job: JobWithNextRun): string {
  const status = job.enabled ? '▶️ active' : '⏸️ disabled';
  const payloadText =
    job.payload.kind === 'agentTurn' ? job.payload.message : job.payload.text;
  const truncatedPayload =
    payloadText.length > 100 ? `${payloadText.slice(0, 100)}...` : payloadText;

  return [
    `${status} ${job.name ?? '(unnamed)'} (${job.id})`,
    `  Schedule: ${job.schedule}${job.timezone ? ` (${job.timezone})` : ''}`,
    `  Type: ${job.payload.kind}`,
    `  Message: ${truncatedPayload}`,
    `  Next run: ${job.next_run ?? 'N/A'}`,
    `  Session: ${job.sessionTarget ?? 'main'}`,
    `  Agent: ${job.agentId?.trim() || '(default)'}`,
    `  Workspace: ${job.workingDirectory?.trim() || '(agent default)'}`,
  ].join('\n');
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
      'Each job has a cron schedule and a message the agent runs when triggered (agent turn).\n\n' +
      'ACTIONS:\n' +
      '- list: Show all scheduled jobs with status and next run time\n' +
      '- create: Create a job (requires schedule and message; optional name, timezone, sessionTarget, agentId, workingDirectory)\n' +
      '- update: Change schedule, message, name, timezone, sessionTarget, agentId, or workingDirectory (requires jobId)\n' +
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
            if (!params.schedule?.trim() || !params.message?.trim()) {
              return textResult('Error: create requires schedule and message.');
            }

            const scanResult = scanCronPrompt(params.message);
            if (scanResult) {
              return textResult(`Error: ${scanResult}`);
            }

            const payload: CronPayload = {
              kind: 'agentTurn',
              message: params.message.trim(),
            };

            const result = await cron.addJob(params.schedule.trim(), {
              name: params.name?.trim() || undefined,
              timezone: params.timezone?.trim() || undefined,
              sessionTarget: params.sessionTarget ?? 'isolated',
              ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
              ...(params.workingDirectory?.trim()
                ? { workingDirectory: params.workingDirectory.trim() }
                : {}),
              payload,
            });

            return textResult(
              `Created job${params.name ? ` "${params.name.trim()}"` : ''} (${result.id})\n` +
                `Schedule: ${result.schedule}`,
            );
          }

          case 'update': {
            if (!params.jobId?.trim()) {
              return textResult('Error: update requires jobId.');
            }

            const updates: Partial<Omit<JobData, 'id' | 'created_at' | 'updated_at'>> = {};
            if (params.schedule?.trim()) {
              updates.schedule = params.schedule.trim();
            }
            if (params.message != null && params.message.trim()) {
              const scanResult = scanCronPrompt(params.message);
              if (scanResult) {
                return textResult(`Error: ${scanResult}`);
              }
              updates.payload = { kind: 'agentTurn', message: params.message.trim() };
            }
            if (params.timezone?.trim()) {
              updates.timezone = params.timezone.trim();
            }
            if (params.name !== undefined) {
              updates.name = params.name.trim() || undefined;
            }
            if (params.sessionTarget !== undefined) {
              updates.sessionTarget = params.sessionTarget;
            }
            if (params.agentId !== undefined) {
              const t = params.agentId.trim();
              updates.agentId = t || null;
            }
            if (params.workingDirectory !== undefined) {
              const t = params.workingDirectory.trim();
              updates.workingDirectory = t || null;
            }

            if (Object.keys(updates).length === 0) {
              return textResult(
                'Error: update requires at least one of schedule, message, name, timezone, sessionTarget, agentId, workingDirectory.',
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
