import type { Config } from '../../config/schema.js';
import type { CronService } from '../../cron/index.js';
import {
  DREAMING_CRON_TAG,
  DREAMING_SWEEP_TOKEN,
  DREAMING_LIGHT_CRON_NAME,
  DREAMING_LIGHT_SWEEP_TOKEN,
  DREAMING_CRON_NAME,
  DREAMING_REM_CRON_NAME,
  DREAMING_REM_SWEEP_TOKEN,
} from '../memory/dreaming/constants.js';
import { resolveDreamingConfig } from '../memory/dreaming/config.js';

/**
 * Reconcile managed Dreaming cron jobs against the current effective config.
 */
export async function reconcileManagedDreamingCronJobs(
  cron: CronService,
  effectiveConfig: Config | undefined,
): Promise<void> {
  const dreaming = resolveDreamingConfig(effectiveConfig);
  const jobs = await cron.listJobs();
  const managed = jobs.filter((job) => job.name?.includes?.(DREAMING_CRON_TAG) ?? false);

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
    const phaseJobs = managed.filter((job) => job.name === spec.cronName);

    if (!spec.phaseEnabled) {
      for (const job of phaseJobs) {
        await cron.removeJob(job.id).catch(() => {});
      }
      continue;
    }

    const desiredPayload = { kind: 'agentTurn' as const, message: spec.token };

    if (phaseJobs.length === 0) {
      await cron.addJob(spec.schedule, {
        name: spec.cronName,
        timezone: dreaming.timezone,
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
      primary.schedule !== spec.schedule ||
      (dreaming.timezone ?? null) !== (primary.timezone ?? null) ||
      primary.sessionTarget !== 'isolated' ||
      payloadMessage !== spec.token ||
      primary.enabled !== true ||
      primary.name !== spec.cronName;

    if (needsUpdate) {
      await cron.updateJob(primary.id, {
        schedule: spec.schedule,
        timezone: dreaming.timezone ?? undefined,
        sessionTarget: 'isolated',
        name: spec.cronName,
        payload: desiredPayload,
        enabled: true,
      } as any);
    }
  }
}
