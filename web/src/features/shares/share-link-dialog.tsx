import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, Globe, Loader2, Wifi, WifiOff, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { CopyTextRowList } from '@/components/ui/copy-text-row';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type {
  CreateShareParams,
  CreateShareResponse,
  ShareReachability,
} from '@/features/shares/shares-api';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const SHARE_EXPIRES_AT_ZH = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const SHARE_EXPIRES_AT_EN = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export type ShareLinkResult = CreateShareResponse['payload'];

type UrlRow = {
  key: string;
  label: string;
  url: string;
};

function buildUrlRows(
  shareUrl: string,
  lanUrl: string | null,
  reachability: ShareReachability,
  t: ReturnType<typeof messages>['sharesSettings'],
): UrlRow[] {
  if (reachability === 'public') {
    const rows: UrlRow[] = [
      {
        key: 'public',
        label: t.publicUrlLabel,
        url: shareUrl,
      },
    ];
    if (lanUrl) {
      rows.push({
        key: 'lan',
        label: t.lanUrlLabel,
        url: lanUrl,
      });
    }
    return rows;
  }
  if (reachability === 'lan') {
    return [
      {
        key: 'lan',
        label: t.lanUrlLabel,
        url: shareUrl,
      },
    ];
  }
  return [
    {
      key: 'local',
      label: t.localUrlLabel,
      url: shareUrl,
    },
  ];
}

export function ShareUrlCopyRows({
  shareUrl,
  lanUrl,
  reachability,
  compact,
}: {
  shareUrl: string;
  lanUrl?: string | null;
  reachability: ShareReachability;
  compact?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const rows = useMemo(
    () => buildUrlRows(shareUrl, lanUrl ?? null, reachability, t),
    [shareUrl, lanUrl, reachability, t],
  );
  const copyLabels = useMemo(
    () => ({ copy: t.copy, copied: t.copied, copyFailed: t.copyFailed }),
    [t],
  );

  return (
    <CopyTextRowList
      rows={rows.map((row) => ({ key: row.key, label: row.label, text: row.url }))}
      compact={compact}
      labels={copyLabels}
    />
  );
}

function formatExpiresAt(isoDate: string, language: 'en' | 'zh'): string {
  return (language === 'zh' ? SHARE_EXPIRES_AT_ZH : SHARE_EXPIRES_AT_EN).format(new Date(isoDate));
}

export function ReachabilityHint({
  reachability,
  reachabilityHint,
}: {
  reachability: ShareReachability;
  reachabilityHint?: string | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;

  if (reachability === 'public') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <Globe className="size-3" />
        {t.reachPublic}
      </span>
    );
  }
  if (reachability === 'lan') {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <Wifi className="size-3" />
        {t.reachLan}
        {reachabilityHint ? <span className="text-fg-muted"> — {reachabilityHint}</span> : null}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-xs text-fg-subtle">
        <WifiOff className="size-3" />
        {t.reachLocal}
      </span>
      <span className="flex items-center gap-1 text-xs text-fg-muted">
        {reachabilityHint ?? t.reachLocalHint}{' '}
        <Link to="/settings/remote-access?tab=public" className="inline-flex items-center gap-0.5 text-accent hover:underline">
          {t.openTunnel}
          <ExternalLink className="size-3" />
        </Link>
      </span>
    </div>
  );
}

function ShareLinkResultContent({ result }: { result: ShareLinkResult }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-fg">{result.fileName}</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {t.expiresLabel}: {formatExpiresAt(result.expiresAt, language)}
        </p>
      </div>
      <ShareUrlCopyRows
        shareUrl={result.shareUrl}
        lanUrl={result.lanUrl}
        reachability={result.reachability}
      />
      <ReachabilityHint
        reachability={result.reachability}
        reachabilityHint={result.reachabilityHint}
      />
    </div>
  );
}

function ShareLinkConfirmation({
  params,
  loading,
  error,
  onConfirm,
  onCancel,
}: {
  params: CreateShareParams;
  loading: boolean;
  error?: string | null;
  onConfirm: (options: Pick<CreateShareParams, 'ttlMs' | 'maxViews' | 'description'>) => void;
  onCancel: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const [ttlMs, setTtlMs] = useState(params.ttlMs ?? 86_400_000);
  const [maxViews, setMaxViews] = useState<number | null>(params.maxViews ?? null);
  const [description, setDescription] = useState(params.description ?? '');

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm({ ttlMs, maxViews, description: description.trim() || undefined });
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="rounded-lg border border-edge-subtle bg-surface-muted/45 px-3 py-2.5">
          <p className="truncate text-sm font-medium text-fg" title={params.fileName ?? params.path ?? params.fileId ?? params.uri}>{params.fileName ?? params.path ?? params.fileId ?? params.uri}</p>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{t.shareConfirmHint}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-fg">{t.ttlLabel}</span>
            <Select
              value={ttlMs}
              disabled={loading}
              onChange={(event) => setTtlMs(Number(event.target.value))}
            >
              <SelectOption value={3_600_000}>{t.ttlOptions['1h']}</SelectOption>
              <SelectOption value={21_600_000}>{t.ttlOptions['6h']}</SelectOption>
              <SelectOption value={86_400_000}>{t.ttlOptions['24h']}</SelectOption>
              <SelectOption value={259_200_000}>{t.ttlOptions['3d']}</SelectOption>
              <SelectOption value={604_800_000}>{t.ttlOptions['7d']}</SelectOption>
              <SelectOption value={2_592_000_000}>{t.ttlOptions['30d']}</SelectOption>
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-fg">{t.maxViewsLabel}</span>
            <Select
              value={maxViews ?? 'unlimited'}
              disabled={loading}
              onChange={(event) => setMaxViews(event.target.value === 'unlimited' ? null : Number(event.target.value))}
            >
              <SelectOption value="unlimited">{t.maxViewsUnlimited}</SelectOption>
              <SelectOption value={1}>1</SelectOption>
              <SelectOption value={5}>5</SelectOption>
              <SelectOption value={10}>10</SelectOption>
              <SelectOption value={50}>50</SelectOption>
            </Select>
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg">{t.descriptionLabel}</span>
          <input
            type="text"
            value={description}
            disabled={loading}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.descriptionPlaceholder}
            className="h-10 rounded-lg border border-edge bg-surface-subtle px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-edge-strong disabled:opacity-60"
          />
        </label>

        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-4 py-3">
        <Button type="button" variant="ghost" disabled={loading} onClick={onCancel}>{t.cancel}</Button>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? t.creating : t.createButton}
        </Button>
      </div>
    </form>
  );
}

export function ShareLinkDialog({
  open,
  onOpenChange,
  loading,
  error,
  result,
  pendingParams,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  error?: string | null;
  result?: ShareLinkResult | null;
  pendingParams?: CreateShareParams | null;
  onConfirm?: (options: Pick<CreateShareParams, 'ttlMs' | 'maxViews' | 'description'>) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const m = messages(language);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[180] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[181] flex h-[min(31rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col',
            'overflow-hidden rounded-lg border border-edge bg-surface-panel shadow-popover outline-none',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-edge px-4 py-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">
                {result ? t.shareCreated : t.shareConfirmTitle}
              </Dialog.Title>
              {!result && pendingParams ? (
                <Dialog.Description className="mt-0.5 text-xs text-fg-muted">{t.createHint}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                aria-label={t.cancel}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {result ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ShareLinkResultContent result={result} />
            </div>
          ) : pendingParams && onConfirm ? (
            <ShareLinkConfirmation
              key={`${pendingParams.fileId ?? pendingParams.uri ?? pendingParams.path}:${pendingParams.sessionKey ?? pendingParams.agentId ?? ''}`}
              params={pendingParams}
              loading={Boolean(loading)}
              error={error}
              onConfirm={onConfirm}
              onCancel={() => onOpenChange(false)}
            />
          ) : loading ? (
            <p className="flex items-center gap-2 p-4 text-sm text-fg-muted">
              <Loader2 className="size-4 animate-spin" />
              {m.workspace.sharing}
            </p>
          ) : error ? (
            <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
