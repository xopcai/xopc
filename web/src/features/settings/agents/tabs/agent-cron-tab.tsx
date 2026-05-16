import { AlarmClock } from 'lucide-react';

import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { cronJobBodyText, type CronJob } from '@/features/cron/cron-api';
import { ScheduleSummary } from '@/features/scheduling/schedule-summary';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { agentsSettingsInputClass } from '../utils';

export function AgentCronTab(props: {
  a: AgentsSettingsMessages;
  data: { agents: GatewayAgentRow[] };
  selected: GatewayAgentRow;
  busy: boolean;
  cronLoading: boolean;
  agentCronJobs: CronJob[];
  onSetCronJobAgent: (job: CronJob, agentKey: string) => void;
}) {
  const { a, data, busy, cronLoading, agentCronJobs, onSetCronJobAgent } = props;
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const scheduleBadgeLabels = m.cron.scheduleBadge;

  return (
    <SettingsFormSection className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SettingsFormSectionHeader
        className="shrink-0"
        icon={AlarmClock}
        title={a.cronTitle}
        subtitle={a.cronHint}
      />
      {cronLoading ? (
        <p className="text-sm text-fg-muted">{a.cronLoading}</p>
      ) : agentCronJobs.length === 0 ? (
        <p className="text-sm text-fg-muted">{a.cronNone}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-edge text-fg-muted">
                <th className="py-2 pr-3 font-medium">{a.cronColSchedule}</th>
                <th className="py-2 pr-3 font-medium">{a.cronColMessage}</th>
                <th className="py-2 pr-3 font-medium">{a.cronColSession}</th>
                <th className="py-2 pr-3 font-medium">{a.cronColAgent}</th>
              </tr>
            </thead>
            <tbody>
              {agentCronJobs.map((job) => {
                const usesDefaultAgent = !job.agentId?.trim();
                const value = usesDefaultAgent ? '' : job.agentId!.trim().toLowerCase();
                return (
                  <tr key={job.id} className="border-b border-edge-subtle">
                    <td className="py-2 pr-3">
                      <div className="flex flex-col gap-0.5">
                        <ScheduleSummary
                          kind="cron"
                          expression={job.schedule}
                          locale={localeTag}
                          labels={scheduleBadgeLabels}
                          timezone={job.timezone}
                          nextRun={job.next_run}
                          className="text-sm font-medium text-fg"
                        />
                        <span className="truncate font-mono text-[0.65rem] text-fg-subtle" title={job.schedule}>
                          {job.schedule}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[12rem] truncate py-2 pr-3 text-xs" title={cronJobBodyText(job)}>
                      {cronJobBodyText(job)}
                    </td>
                    <td className="py-2 pr-3 text-xs">{job.sessionTarget ?? 'main'}</td>
                    <td className="py-2 pr-3">
                      <select
                        className={cn(agentsSettingsInputClass(), 'min-w-[8rem] py-1 text-xs')}
                        value={value}
                        disabled={busy || job.sessionTarget !== 'isolated'}
                        onChange={(e) => void onSetCronJobAgent(job, e.target.value)}
                      >
                        <option value="">{usesDefaultAgent ? a.cronAgentDefault : a.cronAgentClear}</option>
                        {data.agents.map((ag) => (
                          <option key={ag.id} value={ag.id}>
                            {ag.id}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SettingsFormSection>
  );
}
