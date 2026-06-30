import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

type MemoryProvider = {
  id: string;
  displayName: string;
  available: boolean;
  configured: boolean;
  capabilities: Record<string, unknown>;
};

type MemoryRecord = {
  id: string;
  kind: string;
  content: string;
  scope: { agentId: string; workspaceId?: string; sessionKey?: string };
  source: { provider?: string; path?: string; lineStart?: number; lineEnd?: number };
  updatedAt: string;
  tags?: string[];
};

type MemorySignal = {
  signalId: string;
  source: string;
  recordId?: string;
  providerId?: string;
  score?: number;
  createdAt: string;
};

type MemoryConfig = {
  agentId: string;
  memory: {
    mode: 'off' | 'readOnly' | 'confirmWrite' | 'auto';
    sources: string[];
    writePolicy?: Record<string, string>;
    providerRouting?: {
      searchStrategy: 'local-first' | 'external-first' | 'fanout' | 'local-only' | 'external-only';
      writeStrategy: 'local-first' | 'external-first' | 'write-through' | 'local-only' | 'external-only';
      allowExternalWrites: boolean;
      allowedProviderIds?: string[];
      autoWriteKinds?: string[];
    };
  };
};

type MemoryTrace = {
  traceId: string;
  phase: string;
  providerId: string;
  resultCount?: number;
  skippedReason?: string;
  error?: string;
  durationMs: number;
  createdAt: string;
};

const fetcher = <T,>(url: string) => fetchJson<T>(url);
type MemorySearchResponse = { results: Array<{ record: MemoryRecord; score: number; snippet: string }> };

export function MemoryPage({ embedded = false, agentId }: { embedded?: boolean; agentId?: string }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).agentsSettings.memoryPanel;
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});
  const [routingDraft, setRoutingDraft] = useState<NonNullable<MemoryConfig['memory']['providerRouting']>>({
    searchStrategy: 'fanout',
    writeStrategy: 'local-first',
    allowExternalWrites: false,
    allowedProviderIds: [],
    autoWriteKinds: [],
  });

  const { data: providersData } = useSWR<{ providers: MemoryProvider[] }>(
    apiUrl('/api/memory/providers'),
    fetcher,
  );
  const { data: recordsData } = useSWR<{ records: MemoryRecord[] }>(
    apiUrl('/api/memory/records?limit=80'),
    fetcher,
  );
  const { data: signalsData } = useSWR<{ signals: MemorySignal[] }>(
    apiUrl('/api/memory/signals?limit=50'),
    fetcher,
  );
  const { data: tracesData, mutate: mutateTraces } = useSWR<{ traces: MemoryTrace[] }>(
    apiUrl('/api/memory/traces?limit=80'),
    fetcher,
  );
  const { data: configData, mutate: mutateConfig } = useSWR<MemoryConfig>(
    apiUrl(`/api/memory/config${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`),
    fetcher,
  );
  const searchKey = submitted ? apiUrl('/api/memory/search') : null;
  const { data: searchData, isLoading: searchLoading } = useSWR<MemorySearchResponse>(
    searchKey,
    (url: string) =>
      fetchJson<MemorySearchResponse>(url, {
        method: 'POST',
        body: JSON.stringify({ query: submitted, maxResults: 20 }),
      }),
  );

  const records = searchData?.results.map((r) => ({ ...r.record, score: r.score })) ?? recordsData?.records ?? [];
  const providerCount = providersData?.providers.length ?? 0;
  const recordCount = recordsData?.records.length ?? 0;
  const signalCount = signalsData?.signals.length ?? 0;
  const traceCount = tracesData?.traces.length ?? 0;
  const summary = useMemo(
    () => [
      { label: t.providers, value: providerCount },
      { label: t.records, value: recordCount },
      { label: t.signals, value: signalCount },
      { label: t.traceEvents, value: traceCount },
    ],
    [providerCount, recordCount, signalCount, t.providers, t.records, t.signals, t.traceEvents, traceCount],
  );

  useEffect(() => {
    const routing = configData?.memory.providerRouting;
    if (!routing) return;
    setRoutingDraft({
      searchStrategy: routing.searchStrategy ?? 'fanout',
      writeStrategy: routing.writeStrategy ?? 'local-first',
      allowExternalWrites: routing.allowExternalWrites ?? false,
      allowedProviderIds: routing.allowedProviderIds ?? [],
      autoWriteKinds: routing.autoWriteKinds ?? [],
    });
  }, [configData]);

  async function saveRouting() {
    if (!configData) return;
    setSaveStatus(t.saving);
    try {
      await fetchJson(apiUrl('/api/memory/config'), {
        method: 'PATCH',
        body: JSON.stringify({
          agentId: configData.agentId,
          memory: {
            ...configData.memory,
            providerRouting: routingDraft,
          },
        }),
      });
      await mutateConfig();
      setSaveStatus(t.saved);
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : t.saveFailed);
    }
  }

  async function testProvider(providerId: string) {
    setTestStatus((prev) => ({ ...prev, [providerId]: t.testing }));
    try {
      const result = await fetchJson<{ checks: Array<{ name: string; ok: boolean; message?: string }> }>(
        apiUrl(`/api/memory/providers/${encodeURIComponent(providerId)}/test`),
        { method: 'POST' },
      );
      const failed = result.checks.find((check) => !check.ok);
      setTestStatus((prev) => ({
        ...prev,
        [providerId]: failed ? `${failed.name}: ${failed.message ?? t.checkFailed}` : t.testPassed,
      }));
      void mutateTraces();
    } catch (error) {
      setTestStatus((prev) => ({
        ...prev,
        [providerId]: error instanceof Error ? error.message : t.testFailed,
      }));
    }
  }

  return (
    <div
      className={
        embedded
          ? 'flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto overscroll-contain pr-1'
          : 'mx-auto flex w-full max-w-app-main flex-1 flex-col gap-5 px-4 py-6'
      }
    >
      {embedded ? null : (
        <div>
          <h1 className="text-xl font-semibold text-fg">{t.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {summary.map((item) => (
          <div key={item.label} className="rounded-lg border border-edge bg-surface px-4 py-3">
            <div className="text-xs text-fg-muted">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold text-fg">{item.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-edge bg-surface">
        <div className="border-b border-edge px-4 py-3 text-sm font-semibold text-fg">{t.providerPolicy}</div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <label className="text-xs font-medium text-fg-muted">
            {t.searchStrategy}
            <select
              className="mt-1 min-h-10 w-full rounded-md border border-edge bg-surface-panel px-3 text-sm text-fg"
              value={routingDraft.searchStrategy}
              onChange={(event) => setRoutingDraft((prev) => ({ ...prev, searchStrategy: event.target.value as never }))}
            >
              {['fanout', 'local-first', 'external-first', 'local-only', 'external-only'].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-fg-muted">
            {t.writeStrategy}
            <select
              className="mt-1 min-h-10 w-full rounded-md border border-edge bg-surface-panel px-3 text-sm text-fg"
              value={routingDraft.writeStrategy}
              onChange={(event) => setRoutingDraft((prev) => ({ ...prev, writeStrategy: event.target.value as never }))}
            >
              {['local-first', 'write-through', 'external-first', 'local-only', 'external-only'].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-fg md:col-span-2">
            <input
              type="checkbox"
              checked={routingDraft.allowExternalWrites}
              onChange={(event) => setRoutingDraft((prev) => ({ ...prev, allowExternalWrites: event.target.checked }))}
            />
            {t.allowExternalWrites}
          </label>
          <div className="md:col-span-2">
            <div className="mb-2 text-xs font-medium text-fg-muted">{t.writableProviders}</div>
            <div className="flex flex-wrap gap-2">
              {(providersData?.providers ?? []).filter((provider) => !provider.capabilities.local).map((provider) => {
                const checked = routingDraft.allowedProviderIds?.includes(provider.id) ?? false;
                return (
                  <label key={provider.id} className="flex items-center gap-2 rounded-md border border-edge px-3 py-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setRoutingDraft((prev) => ({
                        ...prev,
                        allowedProviderIds: event.target.checked
                          ? [...(prev.allowedProviderIds ?? []), provider.id]
                          : (prev.allowedProviderIds ?? []).filter((id) => id !== provider.id),
                      }))}
                    />
                    {provider.displayName}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button type="button" variant="primary" onClick={saveRouting}>{t.savePolicy}</Button>
            {saveStatus ? <span className="text-sm text-fg-muted">{saveStatus}</span> : null}
          </div>
        </div>
      </section>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <input
          className="min-h-10 flex-1 rounded-md border border-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchPlaceholder}
        />
        <Button className="min-h-10 rounded-md px-4" type="submit" variant="primary">
          {t.search}
        </Button>
      </form>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 rounded-lg border border-edge bg-surface">
          <div className="border-b border-edge px-4 py-3 text-sm font-semibold text-fg">
            {submitted ? `${t.searchResults}${searchLoading ? '…' : ''}` : t.recentRecords}
          </div>
          <div className="divide-y divide-edge">
            {records.map((record) => (
              <article key={record.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <span className="font-medium text-fg">{record.kind}</span>
                  <span>{record.source.provider ?? 'local'}</span>
                  {record.source.path ? <span>{record.source.path}</span> : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg">{record.content}</p>
              </article>
            ))}
            {records.length === 0 ? <div className="px-4 py-8 text-sm text-fg-muted">{t.noRecords}</div> : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="rounded-lg border border-edge bg-surface">
            <div className="border-b border-edge px-4 py-3 text-sm font-semibold text-fg">{t.providers}</div>
            <div className="divide-y divide-edge">
              {(providersData?.providers ?? []).map((provider) => (
                <div key={provider.id} className="px-4 py-3">
                  <div className="text-sm font-medium text-fg">{provider.displayName}</div>
                  <div className="mt-1 text-xs text-fg-muted">
                    {provider.id} · {provider.available ? t.available : t.unavailable}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => testProvider(provider.id)}>
                      {t.test}
                    </Button>
                    {testStatus[provider.id] ? <span className="text-xs text-fg-muted">{testStatus[provider.id]}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-surface">
            <div className="border-b border-edge px-4 py-3 text-sm font-semibold text-fg">{t.signals}</div>
            <div className="divide-y divide-edge">
              {(signalsData?.signals ?? []).map((signal) => (
                <div key={signal.signalId} className="px-4 py-3 text-xs text-fg-muted">
                  <div className="font-medium text-fg">{signal.source}</div>
                  <div>{signal.providerId ?? 'local'} · {new Date(signal.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-surface">
            <div className="border-b border-edge px-4 py-3 text-sm font-semibold text-fg">{t.trace}</div>
            <div className="divide-y divide-edge">
              {(tracesData?.traces ?? []).slice(0, 20).map((trace) => (
                <div key={trace.traceId} className="px-4 py-3 text-xs text-fg-muted">
                  <div className="font-medium text-fg">{trace.phase} · {trace.providerId}</div>
                  <div>{trace.resultCount ?? 0} {(trace.resultCount ?? 0) === 1 ? t.result : t.results} · {trace.durationMs} ms</div>
                  {trace.skippedReason ? <div>{t.skipped}: {trace.skippedReason}</div> : null}
                  {trace.error ? <div className="text-danger">{trace.error}</div> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
