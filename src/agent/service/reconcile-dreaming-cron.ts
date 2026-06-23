import type { Config } from '../../config/schema.js';
import type { CronService } from '../../cron/index.js';
import type { JobData } from '../../cron/types.js';
import {
  DREAMING_SWEEP_TOKEN,
  DREAMING_LIGHT_CRON_NAME,
  DREAMING_LIGHT_SWEEP_TOKEN,
  DREAMING_CRON_NAME,
  DREAMING_REM_CRON_NAME,
  DREAMING_REM_SWEEP_TOKEN,
} from '../memory/dreaming/constants.js';
import { resolveDreamingConfig } from '../memory/dreaming/config.js';

const DREAMING_SWEEP_TOKENS = new Set<string>([
  DREAMING_LIGHT_SWEEP_TOKEN,
  DREAMING_SWEEP_TOKEN,
  DREAMING_REM_SWEEP_TOKEN,
]);

function dreamingSweepTokenFromJob(job: JobData): string | undefined {
  if (job.payload?.kind !== 'agentTurn') {
    return undefined;
  }
  const msg = job.payload.message;
  return typeof msg === 'string' && DREAMING_SWEEP_TOKENS.has(msg) ? msg : undefined;
}

/**
 * Reconcile managed Dreaming cron jobs against the current effective config.
 */
export async function reconcileManagedDreamingCronJobs(
  cron: CronService,
  effectiveConfig: Config | undefined,
): Promise<void> {
  const dreaming = resolveDreamingConfig(effectiveConfig);
  const jobs = await cron.listJobs();
  /** Match by sweep token — job names omit `[managed-by=…]`, so name-only matching never saw these jobs and re-added them every reconcile. */
  const managed = jobs.filter((job) => dreamingSweepTokenFromJob(job) !== undefined);

  const phaseSpecs: Array<{
    cronName: string;
    token: string;
    schedule: string;
    phaseEnabled: boolean;
  }> = [
    {
      cronName: DREAMING_LIGHT_CRON_NAME,
      token: DREAMING_LIGHT_SWEEP_TOKEN,
      schedule: dreaming.phases.light.cron,
      phaseEnabled: dreaming.phases.light.enabled,
    },
    {
      cronName: DREAMING_CRON_NAME,
      token: DREAMING_SWEEP_TOKEN,
      schedule: dreaming.phases.deep.cron,
      phaseEnabled: dreaming.phases.deep.enabled,
    },
    {
      cronName: DREAMING_REM_CRON_NAME,
      token: DREAMING_REM_SWEEP_TOKEN,
      schedule: dreaming.phases.rem.cron,
      phaseEnabled: dreaming.phases.rem.enabled,
    },
  ];

  if (!dreaming.enabled) {
    for (const job of managed) {
      await cron.removeJob(job.id).catch(() => {});
    }
    return;
  }

  for (const spec of phaseSpecs) {
    const phaseJobs = managed.filter((job) => dreamingSweepTokenFromJob(job) === spec.token);

    if (!spec.phaseEnabled) {
      for (const job of phaseJobs) {
        await cron.removeJob(job.id).catch(() => {});
      }
      continue;
    }

    const desiredPayload = { kind: 'agentTurn' as const, message: spec.token };
    const desiredSchedule = {
      kind: 'cron' as const,
      expr: spec.schedule,
      ...(dreaming.timezone ? { tz: dreaming.timezone } : {}),
    };

    if (phaseJobs.length === 0) {
      await cron.addJob(desiredSchedule, {
        name: spec.cronName,
        sessionTarget: 'isolated' as const,
        payload: desiredPayload,
        enabled: true,
      } as any);
      continue;
    }

    const primary = phaseJobs[0]!;
    for (const dup of phaseJobs.slice(1)) {
      await cron.removeJob(dup.id).catch(() => {});
    }

    const payloadMessage =
      primary.payload?.kind === 'agentTurn'
        ? primary.payload.message
        : (primary.payload as any)?.text;
    const needsUpdate =
      JSON.stringify(primary.schedule) !== JSON.stringify(desiredSchedule) ||
      primary.sessionTarget !== 'isolated' ||
      payloadMessage !== spec.token ||
      primary.enabled !== true ||
      primary.name !== spec.cronName;

    if (needsUpdate) {
      await cron.updateJob(primary.id, {
        schedule: desiredSchedule,
        sessionTarget: 'isolated',
        name: spec.cronName,
        payload: desiredPayload,
        enabled: true,
      } as any);
    }
  }
}
