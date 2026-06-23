import { Command } from 'commander';
import { register, formatExamples } from '../registry.js';
import type { CLIContext } from '../registry.js';
import { withCronService } from './cron-cli.js';
import { describeSchedule, type CronSchedule } from '../../cron/index.js';

function parseDurationMs(value: string): number | null {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? 'ms').toLowerCase();
  const factor = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1;
  return amount > 0 ? amount * factor : null;
}

function resolveSchedule(options: { at?: string; every?: string; cron?: string; tz?: string; schedule?: string }): CronSchedule | null {
  const chosen = [options.at, options.every, options.cron, options.schedule].filter((v) => typeof v === 'string' && v.trim()).length;
  if (chosen !== 1) return null;
  if (options.at?.trim()) {
    const raw = options.at.trim();
    const rel = parseDurationMs(raw);
    return { kind: 'at', at: new Date(rel ? Date.now() + rel : Date.parse(raw)).toISOString() };
  }
  if (options.every?.trim()) {
    const everyMs = parseDurationMs(options.every);
    return everyMs ? { kind: 'every', everyMs, anchorMs: Date.now() } : null;
  }
  const expr = options.cron?.trim() || options.schedule?.trim();
  return expr ? { kind: 'cron', expr, ...(options.tz?.trim() ? { tz: options.tz.trim() } : {}) } : null;
}

function createCronCommand(_ctx: CLIContext): Command {
  const cmd = new Command('cron')
    .description('Manage scheduled tasks')
    .addHelpText(
      'after',
      formatExamples([
        'xopc cron list                              # List all tasks',
        'xopc cron add --cron "0 9 * * *" --message "Good morning"',
        'xopc cron add --every 1h --message "Check for updates"',
        'xopc cron add --at 20m --message "Remind me"',
        'xopc cron enable <job-id>                   # Enable a task',
        'xopc cron disable <job-id>                  # Disable a task',
        'xopc cron run <job-id>                      # Run a task now',
        'xopc cron remove <job-id>                   # Remove a task',
      ]),
    );

  cmd.addCommand(
    new Command('list')
      .description('List all scheduled tasks')
      .action(async () => {
        await withCronService(async (cronService) => {
          const jobs = await cronService.listJobs();

          if (jobs.length === 0) {
            console.log('No scheduled tasks.');
            return;
          }

          console.log('Scheduled Tasks:\n');
          const { getCronPayloadText } = await import('../../cron/job-content.js');
          for (const job of jobs) {
            const state = job.enabled ? 'enabled ' : 'disabled';
            console.log(`  ${job.id} [${state}] - ${describeSchedule(job.schedule)}`);
            console.log(`     ${getCronPayloadText({ payload: job.payload })}`);
            console.log(`     Next: ${job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : 'N/A'}`);
            console.log();
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('add')
      .description('Add a scheduled task')
      .option('--name <text>', 'Task name')
      .option('--at <time>', 'One-shot time: ISO timestamp or duration like 20m')
      .option('--every <duration>', 'Interval like 10m, 1h, 1d')
      .option('--cron <expr>', 'Cron expression (e.g., "0 9 * * *")')
      .option('--tz <iana>', 'IANA timezone for --cron')
      .option('--message <text>', 'Message to send (system event)')
      .option('--workflow <id>', 'Workflow definition id')
      .option('--goal <text>', 'Optional workflow goal')
      .option('--input-json <json>', 'Workflow input payload as JSON object')
      .option('--agent-id <id>', 'Agent profile for workflow or isolated jobs')
      .option('--no-wait', 'Start workflow and return without waiting for completion')
      .option('--channel <name>', 'Delivery channel (e.g. telegram)')
      .option('--to <chatId>', 'Delivery recipient chat id')
      .action(async (options) => {
        const hasWorkflow = Boolean(options.workflow?.trim());
        const hasMessage = Boolean(options.message?.trim());
        const schedule = resolveSchedule(options);
        if (!schedule || (!hasWorkflow && !hasMessage) || (hasWorkflow && hasMessage)) {
          console.error(
            'Error: provide exactly one schedule (--at, --every, --cron) and exactly one of --message or --workflow',
          );
          process.exit(1);
        }

        await withCronService(async (cronService) => {
          if (hasWorkflow) {
            let inputEnvelope: { payload: unknown } | undefined;
            if (options.inputJson) {
              try {
                inputEnvelope = { payload: JSON.parse(options.inputJson) as unknown };
              } catch {
                console.error('Error: --input-json must be valid JSON');
                process.exit(1);
              }
            }
            const agentId = options.agentId?.trim() || undefined;
            const delivery =
              options.channel?.trim() && options.to?.trim()
                ? {
                    mode: 'announce' as const,
                    channel: options.channel.trim(),
                    to: options.to.trim(),
                  }
                : undefined;
            const result = await cronService.addJob(schedule, {
              name: options.name,
              sessionTarget: 'isolated',
              ...(agentId ? { agentId } : {}),
              delivery,
              payload: {
                kind: 'workflowRun',
                definitionId: options.workflow.trim(),
                ...(options.goal?.trim() ? { goal: options.goal.trim() } : {}),
                ...(inputEnvelope ? { inputEnvelope } : {}),
                ...(agentId ? { agentId } : {}),
                ...(options.noWait ? { waitForCompletion: false } : {}),
              },
            });
            console.log(`✅ Added workflow job ${result.id}`);
            console.log(`   Schedule: ${describeSchedule(result.schedule)}`);
            console.log(`   Workflow: ${options.workflow.trim()}`);
            return;
          }

          const result = await cronService.addJob(schedule, {
            name: options.name,
            payload: { kind: 'systemEvent', text: options.message },
          });

          console.log(`✅ Added job ${result.id}`);
          console.log(`   Schedule: ${describeSchedule(result.schedule)}`);
        });
      }),
  );

  cmd.addCommand(
    new Command('remove')
      .description('Remove a scheduled task')
      .argument('<id>', 'Job ID')
      .action(async (id) => {
        await withCronService(async (cronService) => {
          const success = await cronService.removeJob(id);
          if (success) {
            console.log(`✅ Removed job ${id}`);
          } else {
            console.error(`Job ${id} not found`);
            process.exit(1);
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('enable')
      .description('Enable a scheduled task')
      .argument('<id>', 'Job ID')
      .action(async (id) => {
        await withCronService(async (cronService) => {
          const success = await cronService.toggleJob(id, true);
          if (success) {
            console.log(`✅ Enabled job ${id}`);
          } else {
            console.error(`Job ${id} not found`);
            process.exit(1);
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('disable')
      .description('Disable a scheduled task')
      .argument('<id>', 'Job ID')
      .action(async (id) => {
        await withCronService(async (cronService) => {
          const success = await cronService.toggleJob(id, false);
          if (success) {
            console.log(`✅ Disabled job ${id}`);
          } else {
            console.error(`Job ${id} not found`);
            process.exit(1);
          }
        });
      }),
  );

  const runNowAction = async (id: string) => {
    await withCronService(async (cronService) => {
      try {
        await cronService.runJobNow(id);
        console.log(`✅ Triggered job ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });
  };

  cmd.addCommand(
    new Command('run')
      .description('Run a scheduled task immediately')
      .argument('<id>', 'Job ID')
      .action(runNowAction),
  );

  cmd.addCommand(
    new Command('trigger')
      .description('Alias for `cron run`')
      .argument('<id>', 'Job ID')
      .action(runNowAction),
  );

  return cmd;
}

register({
  id: 'cron',
  name: 'cron',
  description: 'Manage scheduled tasks',
  factory: createCronCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopc cron list',
      'xopc cron add --cron "0 9 * * *" --message "Hello"',
      'xopc cron add --every 1h --workflow weekly_review',
      'xopc cron enable abc12345',
      'xopc cron run abc12345',
    ],
  },
});

export { createCronCommand };
