import { cloudAccountSummarySchema, creditDecimal, type CloudAccountSummary } from '@xopcai/gateway-contract';
import { AlertTriangle, Cloud, ExternalLink, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

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
  reserved: string;
  purchased: string;
  granted: string;
  expiring: string;
  tokenUsage: string;
}

function formatCredits(micro: string): string {
  const roundedMicro = ((BigInt(micro) + 500n) / 1000n) * 1000n;
  return creditDecimal(String(roundedMicro));
}

async function fetchAccountSummary(): Promise<CloudAccountSummary> {
  const response = await fetchJson<{ ok: true; payload: CloudAccountSummary }>(
    apiUrl('/api/models/xopc-cloud/account-summary'),
  );
  return cloudAccountSummarySchema.parse(response.payload);
}

export function XopcCloudAccountCard({ labels, children }: { labels: XopcCloudAccountMessages; children?: ReactNode }) {
  const language = useLocaleStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    '/api/models/xopc-cloud/account-summary',
    fetchAccountSummary,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (error || !data) {
    return (
      <section className="rounded-xl bg-surface-hover/25 p-4">
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
        {children}
      </section>
    );
  }

  const number = new Intl.NumberFormat(locale);
  const usageSummary = labels.usageSummary
    .replace('{{credits}}', formatCredits(data.usage.chargedCreditMicro))
    .replace('{{requests}}', number.format(data.usage.requests));

  return (
    <section className="rounded-xl bg-surface-hover/40 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Cloud className="size-4 text-accent-fg" aria-hidden />
          <h2 className="text-sm font-semibold text-fg">{labels.title}</h2>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            {labels.connected}
          </span>
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

      <div className="mt-4 grid gap-4 rounded-lg bg-surface-base/45 p-3 sm:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] sm:gap-6">
        <div>
          <p className="text-xs font-medium text-fg-subtle">{labels.availableCredits}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-fg">
            {formatCredits(data.balance.availableCreditMicro)}
            <span className="ml-2 text-sm font-medium text-fg-muted">Credits</span>
          </p>
          {data.balance.availableCreditMicro === '0' ? (
            <p className="mt-1 text-sm font-medium text-danger">{labels.zeroBalance}</p>
          ) : null}
          <div className="mt-2 space-y-1 text-xs text-fg-muted">
            <div>{labels.purchased}: {formatCredits(data.balance.purchasedCreditMicro)} Credits</div>
            <div>{labels.granted}: {formatCredits(data.balance.grantedCreditMicro)} Credits</div>
            <div>{labels.reserved}: {formatCredits(String(BigInt(data.balance.usageReservedCreditMicro) + BigInt(data.balance.refundReservedCreditMicro)))} Credits</div>
          </div>
          {data.balance.expiring[0] ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {labels.expiring.replace('{{credits}}', formatCredits(data.balance.expiring[0].creditMicro))
              .replace('{{date}}', new Date(data.balance.expiring[0].expiresAt).toLocaleDateString(locale))}
          </p> : null}
        </div>
        <div>
          <p className="text-xs font-medium text-fg-subtle">{labels.recentUsage}</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">{usageSummary}</p>
          <details className="mt-2 text-xs text-fg-subtle">
            <summary className="cursor-pointer">{labels.tokenUsage}</summary>
            <p className="mt-1">{number.format(data.usage.totalTokens)} tokens</p>
          </details>
          <p className="mt-1 text-xs text-fg-subtle">
            {labels.updatedAt.replace('{{time}}', new Date(data.balance.updatedAt).toLocaleString(locale))}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}
