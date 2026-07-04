import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type MigrationItem = {
  id: string;
  title: string;
  kind: string;
  safety: string;
  status: string;
  message: string;
};

type MigrationStatusPayload = {
  pending: number;
  items: MigrationItem[];
};

type ApiResponse<T> = { ok: boolean; payload: T };

export type MigrationStatusMessages = {
  title: string;
  checking: string;
  checkFailed: string;
  upToDate: string;
  manualAttention: string;
  safeRepairs: string;
  apply: string;
  applying: string;
};

async function fetchMigrationStatus(): Promise<MigrationStatusPayload> {
  const res = await fetchJson<ApiResponse<MigrationStatusPayload>>(apiUrl('/api/migrations/status'));
  return res.payload;
}

async function applyMigrations(): Promise<void> {
  await fetchJson<ApiResponse<unknown>>(apiUrl('/api/migrations/apply'), { method: 'POST', body: '{}' });
}

export function MigrationStatusCard({ messages }: { messages: MigrationStatusMessages }) {
  const { data, error, isLoading, mutate } = useSWR('settings-migration-status', fetchMigrationStatus, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function onApply() {
    setApplying(true);
    setApplyError(null);
    try {
      await applyMigrations();
      await mutate();
      window.dispatchEvent(new CustomEvent('config-reload'));
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-edge bg-surface-panel p-4">
        <h2 className="text-sm font-semibold text-fg">{messages.title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{messages.checking}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-edge bg-surface-panel p-4">
        <h2 className="text-sm font-semibold text-fg">{messages.title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{messages.checkFailed}</p>
      </section>
    );
  }

  const items = data?.items ?? [];
  const conflicts = items.filter((item) => item.status === 'conflict' || item.status === 'error');
  const autoItems = items.filter((item) => item.safety === 'auto' && item.status === 'planned');
  const needsManualAttention = conflicts.length > 0 || items.some((item) => item.safety !== 'auto');

  return (
    <section className="rounded-2xl border border-edge bg-surface-panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">{messages.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {items.length === 0
              ? messages.upToDate
              : needsManualAttention
                ? messages.manualAttention
                : messages.safeRepairs.replace('{{count}}', String(autoItems.length))}
          </p>
        </div>
        {autoItems.length > 0 && !needsManualAttention ? (
          <Button type="button" variant="primary" className="px-3 py-1.5 text-xs" onClick={() => void onApply()} disabled={applying}>
            {applying ? messages.applying : messages.apply}
          </Button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-edge-subtle bg-surface-base px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-sm font-medium text-fg">{item.title}</div>
                <span className="rounded-full border border-edge px-2 py-0.5 text-[11px] uppercase tracking-wide text-fg-muted">
                  {item.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">{item.message}</p>
            </div>
          ))}
        </div>
      ) : null}
      {applyError ? <p className="mt-3 text-sm text-red-500">{applyError}</p> : null}
    </section>
  );
}
