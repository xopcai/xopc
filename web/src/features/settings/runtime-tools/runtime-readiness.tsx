import { RuntimeImpact } from './runtime-impact';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

import { loadRuntimeTools, runRuntimeOperation, type RuntimeKind } from './runtime-tools-api';

/** Ordinary setup can repair dependencies without editing provisioning policies. */
export function RuntimeReadiness() {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const t = messages(zh ? 'zh' : 'en').runtimeToolsSettings;
  const { data, error, mutate } = useSWR(apiUrl('/api/runtime-tools'), loadRuntimeTools);
  const [busy, setBusy] = useState<RuntimeKind>();
  const [feedback, setFeedback] = useState<string>();
  const statuses = data?.payload.statuses ?? [];
  const needsAttention = statuses.some((status) => !['ready', 'disabled', 'unsupported'].includes(status.state));

  async function repair(runtime: RuntimeKind, repairable: boolean) {
    setBusy(runtime);
    setFeedback(undefined);
    try {
      await runRuntimeOperation({
        runtime,
        action: repairable ? 'repair' : 'install',
        version: data?.payload.config[runtime].version,
        onProgress: (event) => setFeedback(event.message),
      });
      await mutate();
      setFeedback(zh ? '操作完成，已刷新执行环境状态。' : 'Completed and refreshed environment status.');
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <details open={needsAttention || undefined} className="rounded-xl bg-surface-hover/20 p-4">
      <summary className="cursor-pointer text-sm font-medium text-fg">{zh ? '执行环境状态' : 'Execution environment status'}{data ? ` · ${statuses.filter((status) => status.state === 'ready').length}/${statuses.length}` : ''}</summary>
      {error ? <div role="alert" className="mt-3 text-sm text-danger">{t.loadError}<Button variant="ghost" onClick={() => void mutate()}>{t.refresh}</Button></div> : !data ? <Skeleton className="mt-3 h-20" /> : (
        <div className="mt-3 space-y-3">
          <RuntimeImpact statuses={statuses} zh={zh} />
          {statuses.map((status) => (
            <div key={status.runtime} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-sm text-fg">{t.runtimeNames[status.runtime]}</p><p className="text-xs text-fg-muted">{status.message}</p></div>
              {data.payload.config.enabled && data.payload.config[status.runtime].enabled && !['ready', 'disabled', 'unsupported', 'installing'].includes(status.state) ? (
                <Button disabled={Boolean(busy)} onClick={() => void repair(status.runtime, status.repairable)}>{busy === status.runtime ? t.working : status.repairable ? t.repair : t.install}</Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {feedback ? <p role="status" className="mt-3 text-xs text-fg-muted">{feedback}</p> : null}
    </details>
  );
}
