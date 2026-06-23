import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import {
  getAllRunsHistory,
  getChannels,
  getConfig,
  getModels,
  listJobs,
  type ChannelStatus,
  type CronJob,
  type CronRunHistoryRow,
} from '@/features/cron/cron-api';
import { isDreamingManagedCronJob } from '@/features/cron/cron-dreaming-jobs';
import {
  RUN_HISTORY_FETCH_LIMIT,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeekMonday,
} from '@/features/cron/cron-page-lib';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { normalizeHeartbeatFromConfig } from '@/features/settings/heartbeat-config-api';

type FailMessages = {
  failedToLoadJobs: string;
};

export type HistoryRange = 'day' | 'week' | 'month';
export type JobSort = 'created_desc' | 'created_asc';

export function useCronPageData(opts: {
  hasToken: boolean;
  failMessages: FailMessages;
  isHistoryTab: boolean;
}) {
  const { hasToken, failMessages, isHistoryTab } = opts;

  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [chatAgents, setChatAgents] = useState<ChatAgentOption[]>([]);
  const [gatewayConfigRaw, setGatewayConfigRaw] = useState<unknown>(null);
  const [runHistory, setRunHistory] = useState<CronRunHistoryRow[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listJobs();
      setJobs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : failMessages.failedToLoadJobs);
    } finally {
      setLoading(false);
    }
  }, [failMessages.failedToLoadJobs]);

  const loadAux = useCallback(async () => {
    try {
      const [ch, mods, cfg, cfgFull, agentsPayload] = await Promise.all([
        getChannels(),
        getModels(),
        getConfig(),
        fetchGatewayConfigSwrResponse(),
        fetchChatAgents().catch(() => null),
      ]);
      setChannels(ch);
      setAvailableModels(mods);
      setDefaultModel(cfg.model || '');
      setGatewayConfigRaw(cfgFull.payload?.config ?? null);
      if (agentsPayload) setChatAgents(agentsPayload.items);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadRunHistoryOnly = useCallback(async () => {
    setRunHistoryLoading(true);
    try {
      const rows = await getAllRunsHistory(RUN_HISTORY_FETCH_LIMIT);
      setRunHistory(rows);
    } catch {
      /* ignore */
    } finally {
      setRunHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasToken) return;
    void loadJobs();
    void loadAux();
  }, [hasToken, loadJobs, loadAux]);

  useEffect(() => {
    if (!hasToken) return;
    const onReload = () => {
      void fetchGatewayConfigSwrResponse().then((r) => {
        setGatewayConfigRaw(r.payload?.config ?? null);
      });
    };
    window.addEventListener('config-reload', onReload);
    return () => window.removeEventListener('config-reload', onReload);
  }, [hasToken]);

  useEffect(() => {
    if (!hasToken || !isHistoryTab) return;
    void loadRunHistoryOnly();
  }, [hasToken, isHistoryTab, loadRunHistoryOnly]);

  const userCronJobs = useMemo(() => jobs.filter((j) => !isDreamingManagedCronJob(j)), [jobs]);
  const systemCronJobs = useMemo(() => jobs.filter((j) => isDreamingManagedCronJob(j)), [jobs]);

  const heartbeatFromConfig = useMemo(() => normalizeHeartbeatFromConfig(gatewayConfigRaw), [gatewayConfigRaw]);

  const refreshAll = useCallback(() => {
    void loadJobs();
    void loadAux();
    void loadRunHistoryOnly();
  }, [loadJobs, loadAux, loadRunHistoryOnly]);

  return {
    jobs,
    channels,
    availableModels,
    defaultModel,
    chatAgents,
    gatewayConfigRaw,
    runHistory,
    runHistoryLoading,
    loading,
    error,
    setError,
    userCronJobs,
    systemCronJobs,
    heartbeatFromConfig,
    loadJobs,
    loadAux,
    loadRunHistoryOnly,
    refreshAll,
  };
}

export function sortJobsByCreated(arr: CronJob[], sort: JobSort): CronJob[] {
  const next = [...arr];
  next.sort((a, b) => {
    const ta = a.createdAtMs;
    const tb = b.createdAtMs;
    return sort === 'created_desc' ? tb - ta : ta - tb;
  });
  return next;
}

export function filterRunHistory(
  runHistory: CronRunHistoryRow[],
  range: HistoryRange,
  jobFilter: string,
  statusFilter: string,
): CronRunHistoryRow[] {
  const now = new Date();
  const from =
    range === 'day' ? startOfLocalDay(now) : range === 'week' ? startOfLocalWeekMonday(now) : startOfLocalMonth(now);
  return runHistory.filter((row) => {
    if (new Date(row.startedAt) < from) return false;
    if (jobFilter && row.jobId !== jobFilter) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });
}
