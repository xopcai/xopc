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
      .option('--message <text>', 'Message to send')
      .action(async (options) => {
        if (!options.schedule || !options.message) {
          console.error('Error: --schedule and --message are required');
          process.exit(1);
        }

        await withCronService(async (cronService) => {
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
      'xopc cron enable abc12345',
      'xopc cron run abc12345',
    ],
  },
});

export { createCronCommand };
