import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { listJobs, updateJob, type CronJob } from '@/features/cron/cron-api';
import { isDreamingManagedCronJob } from '@/features/cron/cron-dreaming-jobs';
import type { GatewayAgentRow, GatewayAgentsPayload } from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';

import type { AgentPanel } from '../utils';
import { jobMatchesAgent } from '../utils';

export function useAgentsCronJobs(options: {
  panel: AgentPanel;
  hasToken: boolean;
  data: GatewayAgentsPayload | null;
  selected: GatewayAgentRow | null;
  saveErrorMessage: string;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { panel, hasToken, data, selected, saveErrorMessage, setBusy, setError } = options;

  const { data: cronJobs, loading: cronLoading } = useAsyncResource(
    () => listJobs(),
    [panel, hasToken],
    { enabled: panel === 'cron' && hasToken, initial: [] as CronJob[], errorData: [] },
  );
  // Override cron jobs after a manual mutation (onSetCronJobAgent) without refetching twice.
  const [cronJobsOverride, setCronJobsOverride] = useState<CronJob[] | null>(null);
  const effectiveCronJobs = cronJobsOverride ?? cronJobs;

  const agentCronJobs = useMemo(() => {
    if (!data || !selected) {
      return [];
    }
    return effectiveCronJobs.filter(
      (j) => !isDreamingManagedCronJob(j) && jobMatchesAgent(j, selected.id, data.defaultId),
    );
  }, [effectiveCronJobs, data, selected]);

  async function onSetCronJobAgent(job: CronJob, agentKey: string) {
    setBusy(true);
    setError(null);
    try {
      await updateJob(job.id, { agentId: agentKey === '' ? null : agentKey });
      setCronJobsOverride(await listJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : saveErrorMessage);
    } finally {
      setBusy(false);
    }
  }

  return {
    agentCronJobs,
    cronJobs: effectiveCronJobs,
    cronLoading,
    onSetCronJobAgent,
  };
}
