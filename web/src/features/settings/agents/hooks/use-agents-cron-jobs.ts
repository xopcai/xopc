import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { listJobs, updateJob, type CronJob } from '@/features/cron/cron-api';
import { isDreamingManagedCronJob } from '@/features/cron/cron-dreaming-jobs';
import type { GatewayAgentRow, GatewayAgentsPayload } from '@/features/settings/agents-admin-api';

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

  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(false);

  const agentCronJobs = useMemo(() => {
    if (!data || !selected) {
      return [];
    }
    return cronJobs.filter(
      (j) => !isDreamingManagedCronJob(j) && jobMatchesAgent(j, selected.id, data.defaultId),
    );
  }, [cronJobs, data, selected]);

  useEffect(() => {
    if (panel !== 'cron' || !hasToken) {
      return;
    }
    let cancelled = false;
    setCronLoading(true);
    void listJobs()
      .then((j) => {
        if (!cancelled) {
          setCronJobs(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCronJobs([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCronLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken]);

  async function onSetCronJobAgent(job: CronJob, agentKey: string) {
    setBusy(true);
    setError(null);
    try {
      await updateJob(job.id, { agentId: agentKey === '' ? null : agentKey });
      setCronJobs(await listJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : saveErrorMessage);
    } finally {
      setBusy(false);
    }
  }

  return {
    agentCronJobs,
    cronJobs,
    cronLoading,
    onSetCronJobAgent,
  };
}
