import type { CronService } from '../../cron/service.js';

export async function withCronService<T>(fn: (service: CronService) => Promise<T>): Promise<T> {
  const { CronService } = await import('../../cron/index.js');
  const cronService = new CronService();
  await cronService.initialize();
  try {
    return await fn(cronService);
  } finally {
    await cronService.stop();
  }
}
