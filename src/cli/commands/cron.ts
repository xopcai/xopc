import { Command } from 'commander';
import { register, formatExamples } from '../registry.js';
import type { CLIContext } from '../registry.js';

function createCronCommand(_ctx: CLIContext): Command {
  const cmd = new Command('cron')
    .description('Manage scheduled tasks')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot cron list                              # List all tasks',
        'xopcbot cron add --schedule "0 9 * * *" --message "Good morning"',
        'xopcbot cron remove <job-id>                   # Remove a task',
      ])
    );

  cmd.addCommand(
    new Command('list')
      .description('List all scheduled tasks')
      .action(async () => {
        const { CronService } = await import('../../cron/index.js');
        
        const cronService = new CronService();
        const jobs = cronService.listJobs();
        
        if (jobs.length === 0) {
          console.log('No scheduled tasks.');
          return;
        }
        
        console.log('Scheduled Tasks:\n');
        for (const job of jobs) {
          console.log(`  ${job.id} - ${job.schedule}`);
          console.log(`     ${job.message}`);
          console.log(`     Next: ${job.next_run || 'N/A'}`);
          console.log();
        }
      })
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
        
        const { CronService } = await import('../../cron/index.js');
        const cronService = new CronService();
        
        const result = await cronService.addJob(
          options.schedule,
          options.message,
          options.name
        );
        
        console.log(`✅ Added job ${result.id}`);
        console.log(`   Schedule: ${result.schedule}`);
      })
  );

  cmd.addCommand(
    new Command('remove')
      .description('Remove a scheduled task')
      .argument('<id>', 'Job ID')
      .action(async (id) => {
        const { CronService } = await import('../../cron/index.js');
        const cronService = new CronService();
        
        const success = await cronService.removeJob(id);
        if (success) {
          console.log(`✅ Removed job ${id}`);
        } else {
          console.error(`Job ${id} not found`);
          process.exit(1);
        }
      })
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
      'xopcbot cron list',
      'xopcbot cron add --schedule "0 9 * * *" --message "Hello"',
    ],
  },
});
