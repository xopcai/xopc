import * as Dialog from '@radix-ui/react-dialog';
import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { Check, Copy, ExternalLink, Globe, Loader2, Wifi, WifiOff, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { CreateShareResponse, ShareReachability } from '@/features/shares/shares-api';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export type ShareLinkResult = CreateShareResponse['payload'];

const shareUrlTooltipClass =
  '!z-[10000] max-w-[min(28rem,90vw)] rounded-md border border-edge bg-surface-panel px-2.5 py-2 text-left text-xs leading-snug text-fg shadow-lg';

const shareUrlCodeClass =
  'block w-full min-w-0 cursor-default truncate rounded bg-surface-hover px-2 py-1.5 text-xs text-fg';

const shareCopyButtonClass =
  'inline-flex w-[5.25rem] shrink-0 items-center justify-center gap-1 px-2 py-1 text-xs';

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

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('flex min-w-0 flex-col gap-2', compact && 'gap-1.5')}>
        {rows.map((row) => (
          <CopyUrlRow key={row.key} row={row} />
        ))}
      </div>
    </TooltipProvider>
  );
}

function formatExpiresAt(isoDate: string, language: 'en' | 'zh'): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoDate));
}

function CopyUrlRow({ row }: { row: UrlRow }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(row.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [row.url]);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{row.label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_5.25rem] items-center gap-2">
        <div className="min-w-0 overflow-hidden">
          <TooltipRoot>
            <TooltipTrigger asChild>
              <code className={shareUrlCodeClass}>{row.url}</code>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent side="top" sideOffset={6} collisionPadding={12} className={shareUrlTooltipClass}>
                <span className="break-all">{row.url}</span>
              </TooltipContent>
            </TooltipPortal>
          </TooltipRoot>
        </div>
        <Button
          type="button"
          variant="secondary"
          className={shareCopyButtonClass}
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
          <span className="truncate">{copied ? t.copied : t.copy}</span>
        </Button>
      </div>
    </div>
  );
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
        <Link to="/settings/remote-access" className="inline-flex items-center gap-0.5 text-accent hover:underline">
          {t.openTunnel}
          <ExternalLink className="size-3" />
        </Link>
      </span>
    </div>
  );
}

export function ShareLinkResultContent({ result }: { result: ShareLinkResult }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const rows = useMemo(
    () => buildUrlRows(result.shareUrl, result.lanUrl, result.reachability, t),
    [result, t],
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-fg">{result.fileName}</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {t.expiresLabel}: {formatExpiresAt(result.expiresAt, language)}
        </p>
      </div>
      <TooltipProvider delayDuration={300}>
        <div className="flex min-w-0 flex-col gap-3">
          {rows.map((row) => (
            <CopyUrlRow key={row.key} row={row} />
          ))}
        </div>
      </TooltipProvider>
      <ReachabilityHint
        reachability={result.reachability}
        reachabilityHint={result.reachabilityHint}
      />
    </div>
  );
}

export function ShareLinkDialog({
  open,
  onOpenChange,
  loading,
  error,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  error?: string | null;
  result?: ShareLinkResult | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const m = messages(language);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[71] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'overflow-hidden rounded-lg border border-edge bg-surface-panel p-4 shadow-popover outline-none',
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <Dialog.Title className="text-base font-semibold text-fg">{t.shareCreated}</Dialog.Title>
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

          {loading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-fg-muted">
              <Loader2 className="size-4 animate-spin" />
              {m.workspace.sharing}
            </p>
          ) : error ? (
            <p className="py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : result ? (
            <ShareLinkResultContent result={result} />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
