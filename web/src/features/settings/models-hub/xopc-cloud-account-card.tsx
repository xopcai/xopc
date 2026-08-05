import { AlertTriangle, Cloud, ExternalLink, RefreshCw } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

interface XopcCloudAccountSummary {
  balance: {
    credits: number;
    updatedAt: string;
  };
  usage: {
    days: 7;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    errors: number;
    averageLatencyMs: number;
    chargedCredits: number;
  };
  links: {
    details: string;
    purchase: string;
  };
}

export interface XopcCloudAccountMessages {
  title: string;
  connected: string;
  availableCredits: string;
  recentUsage: string;
  usageSummary: string;
  updatedAt: string;
  purchase: string;
  details: string;
  unavailable: string;
  retry: string;
  zeroBalance: string;
}

async function fetchAccountSummary(): Promise<XopcCloudAccountSummary> {
  const response = await fetchJson<{ ok: true; payload: XopcCloudAccountSummary }>(
    apiUrl('/api/models/xopc-cloud/account-summary'),
  );
  return response.payload;
}

export function XopcCloudAccountCard({ labels }: { labels: XopcCloudAccountMessages }) {
  const language = useLocaleStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    '/api/models/xopc-cloud/account-summary',
    fetchAccountSummary,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  if (isLoading) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }

  if (error || !data) {
    return (
      <section className="rounded-2xl border border-edge-subtle bg-surface-panel/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-fg">{labels.title}</h2>
              <p className="mt-1 text-sm text-fg-muted">{labels.unavailable}</p>
            </div>
          </div>
          <Button type="button" variant="secondary" disabled={isValidating} onClick={() => void mutate()}>
            <RefreshCw className={isValidating ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            {labels.retry}
          </Button>
        </div>
      </section>
    );
  }

  const number = new Intl.NumberFormat(locale);
  const usageSummary = labels.usageSummary
    .replace('{{tokens}}', number.format(data.usage.totalTokens))
    .replace('{{credits}}', number.format(data.usage.chargedCredits))
    .replace('{{requests}}', number.format(data.usage.requests));

  return (
    <section className="rounded-2xl border border-edge-subtle bg-surface-panel/40 p-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Cloud className="size-4 text-accent-fg" aria-hidden />
            <h2 className="text-sm font-semibold text-fg">{labels.title}</h2>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {labels.connected}
            </span>
          </div>

          <p className="mt-5 text-xs font-medium text-fg-subtle">{labels.availableCredits}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-fg">
            {number.format(data.balance.credits)}
            <span className="ml-2 text-sm font-medium text-fg-muted">credits</span>
          </p>
          {data.balance.credits === 0 ? (
            <p className="mt-2 text-sm font-medium text-danger">{labels.zeroBalance}</p>
          ) : null}

          <p className="mt-5 text-xs font-medium text-fg-subtle">{labels.recentUsage}</p>
          <p className="mt-1 text-sm text-fg-muted">{usageSummary}</p>
          <p className="mt-2 text-xs text-fg-subtle">
            {labels.updatedAt.replace('{{time}}', new Date(data.balance.updatedAt).toLocaleString(locale))}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="primary">
            <a href={data.links.purchase} target="_blank" rel="noreferrer">
              {labels.purchase}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href={data.links.details} target="_blank" rel="noreferrer">
              {labels.details}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
