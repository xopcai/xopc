import { CronService } from '../cron/service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('HeartbeatService');

export interface HeartbeatConfig {
  intervalMs: number;
  enabled: boolean;
}

export class HeartbeatService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cronService: CronService;

  constructor(cronService: CronService) {
    this.cronService = cronService;
  }

  start(config: HeartbeatConfig): void {
    if (!config.enabled) {
      log.info('Heartbeat disabled');
      return;
    }

    log.info({ intervalMs: config.intervalMs }, 'Starting heartbeat service');

    this.intervalId = setInterval(async () => {
      await this.checkAndWake();
    }, config.intervalMs);
  }

  private async checkAndWake(): Promise<void> {
    try {
      // Check cron metrics
      const metrics = await this.cronService.getMetrics();
      
      // Log status
      log.info({ 
        runningJobs: metrics.runningJobs,
        enabledJobs: metrics.enabledJobs 
      }, 'Heartbeat active');
    } catch (error) {
      log.error({ err: error }, 'Heartbeat error');
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('Heartbeat stopped');
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }
}
