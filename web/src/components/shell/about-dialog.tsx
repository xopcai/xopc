import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BrandLogo } from '@/components/shell/brand-logo';
import { messages } from '@/i18n/messages';
import { webBuildInfo } from '@/lib/build-info';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

const REPO_URL = 'https://github.com/xopcai/xopc';
const RELEASES_URL = 'https://github.com/xopcai/xopc/releases';

type GatewayHealth = {
  version?: string;
  service?: string;
};

function formatBuildDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const d = m.aboutDialog;

  const [gatewayVersion, setGatewayVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGatewayVersion(null);
    void (async () => {
      try {
        const res = await apiFetch(apiUrl('/health'));
        if (!res.ok) throw new Error('health');
        const data = (await res.json()) as GatewayHealth;
        if (!cancelled) {
          setGatewayVersion(typeof data.version === 'string' ? data.version : null);
        }
      } catch {
        if (!cancelled) setGatewayVersion(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const commit = webBuildInfo.commit;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const buildDate = formatBuildDate(webBuildInfo.buildTimeIso, localeTag);
  const year = new Date().getFullYear();
  const copyright = d.copyright.replace('{year}', String(year));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[200] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[201] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-edge bg-surface-panel shadow-popover dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 px-4 pt-3" aria-hidden>
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>

          <div className="px-6 pb-2 pt-1">
            <div className="flex justify-end">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={d.close}
                >
                  <X className="size-4" strokeWidth={2} />
                </button>
              </Dialog.Close>
            </div>

            <div className="-mt-2 flex flex-col items-center text-center">
              <BrandLogo className="size-[4.5rem]" alt={m.appBrand} />
              <Dialog.Title className="mt-3 text-xl font-semibold tracking-tight text-fg">
                {m.appBrand}
              </Dialog.Title>
              <Dialog.Description className="sr-only">{d.windowTitle}</Dialog.Description>
            </div>

            <div className="mt-6 space-y-3 text-sm">
              <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-1">
                <span className="text-fg-muted">{d.versionLabel}</span>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:justify-start">
                  <span className="font-mono text-[13px] text-fg tabular-nums">{webBuildInfo.version}</span>
                  <button
                    type="button"
                    className={cn(
                      'shrink-0 rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] font-medium text-fg-muted',
                      'transition-colors hover:bg-surface-hover hover:text-fg',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                    onClick={() => window.open(RELEASES_URL, '_blank', 'noopener,noreferrer')}
                  >
                    {d.checkUpdates}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1">
                <span className="pt-0.5 text-fg-muted">{d.commitLabel}</span>
                <span className="break-all font-mono text-[11px] leading-snug text-fg">{commit}</span>
              </div>

              <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-1">
                <span className="text-fg-muted">{d.buildDateLabel}</span>
                <span className="text-right text-[13px] text-fg sm:text-left">{buildDate}</span>
              </div>

              <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-1">
                <span className="text-fg-muted">{d.gatewayVersionLabel}</span>
                <span className="text-right font-mono text-[13px] text-fg sm:text-left">
                  {gatewayVersion ?? d.gatewayUnavailable}
                </span>
              </div>

              <p className="pt-0.5 text-[11px] text-fg-subtle">{d.consoleBuildHint}</p>
            </div>

            <div className="mt-6 border-t border-edge-subtle pt-4 text-center text-[11px] leading-relaxed text-fg-muted">
              <p>
                {d.openSourceLead}
                <a
                  className="text-accent-fg underline decoration-accent-fg/40 underline-offset-2 hover:decoration-accent-fg"
                  href={REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {d.openSourceLink}
                </a>
              </p>
              <p className="mt-2">{copyright}</p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
