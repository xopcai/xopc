import { Command } from 'commander';
import { register, formatExamples } from '../registry.js';
import type { CLIContext } from '../registry.js';
import { withCronService } from './cron-cli.js';

function createCronCommand(_ctx: CLIContext): Command {
  const cmd = new Command('cron')
    .description('Manage scheduled tasks')
    .addHelpText(
      'after',
      formatExamples([
        'xopc cron list                              # List all tasks',
        'xopc cron add --schedule "0 9 * * *" --message "Good morning"',
        'xopc cron add --schedule "0 17 * * 5" --workflow weekly_review --goal "Weekly review"',
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
            console.log(`  ${job.id} [${state}] - ${job.schedule}`);
            console.log(`     ${getCronPayloadText({ payload: job.payload })}`);
            console.log(`     Next: ${job.next_run || 'N/A'}`);
            console.log();
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('add')
      .description('Add a scheduled task')
      .option('--name <text>', 'Task name')
      .option('--schedule <cron>', 'Cron expression (e.g., "0 9 * * *")')
      .option('--message <text>', 'Message to send (system event)')
      .option('--workflow <id>', 'Workflow definition id (direct workflow run)')
      .option('--goal <text>', 'Optional workflow goal')
      .option('--input-json <json>', 'Workflow input payload as JSON object')
      .option('--agent-id <id>', 'Agent profile for workflow or isolated jobs')
      .option('--no-wait', 'Start workflow and return without waiting for completion')
      .option('--channel <name>', 'Delivery channel (e.g. telegram)')
      .option('--to <chatId>', 'Delivery recipient chat id')
      .action(async (options) => {
        const hasWorkflow = Boolean(options.workflow?.trim());
        const hasMessage = Boolean(options.message?.trim());
        if (!options.schedule || (!hasWorkflow && !hasMessage) || (hasWorkflow && hasMessage)) {
          console.error(
            'Error: --schedule is required; provide exactly one of --message or --workflow',
          );
          process.exit(1);
        }

        await withCronService(async (cronService) => {
          if (hasWorkflow) {
            const { DEFAULT_WORKFLOW_CRON_WAIT_MS } = await import(
              '../../cron/workflow-run-completion.js'
            );
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
                    mode: 'direct' as const,
                    channel: options.channel.trim(),
                    to: options.to.trim(),
                  }
                : undefined;
            const result = await cronService.addJob(options.schedule, {
              name: options.name,
              sessionTarget: 'isolated',
              timeout: DEFAULT_WORKFLOW_CRON_WAIT_MS,
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
            console.log(`   Schedule: ${result.schedule}`);
            console.log(`   Workflow: ${options.workflow.trim()}`);
            return;
          }

          const result = await cronService.addJob(options.schedule, {
            name: options.name,
            payload: { kind: 'systemEvent', text: options.message },
          });

          console.log(`✅ Added job ${result.id}`);
          console.log(`   Schedule: ${result.schedule}`);
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
      'xopc cron add --schedule "0 9 * * *" --message "Hello"',
      'xopc cron add --schedule "0 17 * * 5" --workflow weekly_review',
      'xopc cron enable abc12345',
      'xopc cron run abc12345',
    ],
  },
});

export { createCronCommand };
