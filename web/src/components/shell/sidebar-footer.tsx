import * as Popover from '@radix-ui/react-popover';
import { Settings, Smartphone, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { DevicePairingTargetKind } from '@xopcai/gateway-contract';

import { AboutDialog } from '@/components/shell/about-dialog';
import { Loopi } from '@/components/brand/loopi';
import { SidebarAppMenu } from '@/components/shell/sidebar-app-menu';
import {
  DEVICE_PAIRING_READINESS_KEY,
  fetchDevicePairingReadiness,
} from '@/features/endpoint-tools/device-access-api';
import { openSupportReport } from '@/features/support/support-report-events';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const DevicePairingWizard = lazy(() => import('@/features/endpoint-tools/device-pairing-wizard').then(m => ({ default: m.DevicePairingWizard })));
const MOBILE_PROMO_DISMISSED_KEY = 'xopc-sidebar-mobile-promo-dismissed-v1';

function readMobilePromoDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(MOBILE_PROMO_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function SidebarFooter({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const hasToken = useGatewayStore((s) => Boolean(s.conversationId));
  const m = messages(language);
  const deviceCopy = m.endpointToolsSettings.deviceAccess;
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pairingDialog, setPairingDialog] = useState<{ open: boolean; targetKind?: DevicePairingTargetKind }>({ open: false });
  const [mobilePromoDismissed, setMobilePromoDismissed] = useState(readMobilePromoDismissed);

  const pairingReadiness = useSWR(
    hasToken ? DEVICE_PAIRING_READINESS_KEY : null,
    fetchDevicePairingReadiness,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const deviceSummary = pairingReadiness.data?.devices;
  const showMobilePromo = Boolean(
    !collapsed
    && hasToken
    && deviceSummary
    && deviceSummary.mobileCount === 0
    && !mobilePromoDismissed,
  );

  const dismissMobilePromo = () => {
    setMobilePromoDismissed(true);
    try {
      globalThis.localStorage?.setItem(MOBILE_PROMO_DISMISSED_KEY, '1');
    } catch {
      /* Ignore storage failures in restricted environments. */
    }
  };

  useEffect(() => {
    void import('@/pages/settings-page');
    void import('@/pages/sessions-page');
    void import('@/pages/logs-page');
    void import('@/pages/automations-page');
    void import('@/features/capabilities/capabilities-page');
  }, []);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col',
        collapsed && 'mt-auto',
        collapsed ? 'items-center px-1 py-2' : 'p-3',
      )}
    >
      {pairingDialog.open ? (
        <Suspense fallback={null}>
          <DevicePairingWizard
            open
            targetKind={pairingDialog.targetKind}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setPairingDialog({ open: false });
            }}
            onPaired={() => void pairingReadiness.mutate()}
          />
        </Suspense>
      ) : null}
      {showMobilePromo ? (
        <div className="mb-2 flex items-center gap-1 rounded-xl border border-edge-subtle bg-surface-panel/80 p-1 shadow-surface transition-colors hover:border-edge">
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setPairingDialog({ open: true, targetKind: 'mobile' })}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
              <Smartphone className="size-3.5" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-medium leading-4 text-fg">{deviceCopy.sidebarMobilePromoTitle}</span>
              <span className="block truncate text-xs leading-4 text-fg-muted">{deviceCopy.sidebarMobilePromoHint}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label={deviceCopy.sidebarMobilePromoDismiss}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={dismissMobilePromo}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      <Popover.Root open={open} onOpenChange={setOpen}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5">
            <Link
              to="/user-model"
              onClick={() => onNavigate?.()}
              className="rounded-full outline-none ring-offset-surface-base transition-transform hover:opacity-95 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 motion-reduce:active:scale-100"
              title={m.nav.profile}
              aria-label={m.nav.profile}
            >
              <Loopi variant="avatar" className="size-10" />
            </Link>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-xl text-fg-muted outline-none ring-offset-surface-base transition-colors',
                  'hover:bg-surface-hover hover:text-fg',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  open && 'bg-accent-soft text-accent-fg',
                )}
                aria-expanded={open}
                aria-haspopup="dialog"
                title={m.sidebar.appMenuAria}
                aria-label={m.sidebar.appMenuAria}
              >
                <Settings className="size-[17px]" strokeWidth={1.5} />
              </button>
            </Popover.Trigger>
          </div>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-1 rounded-xl p-1">
            <Link
              to="/user-model"
              onClick={() => onNavigate?.()}
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-full text-left outline-none transition-transform duration-150 ease-out',
                'hover:bg-surface-active/70',
                'hover:opacity-95 active:scale-95',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
              )}
              title={m.nav.profile}
              aria-label={m.nav.profile}
            >
              <Loopi variant="avatar" className="size-10" />
            </Link>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left text-fg-muted transition-colors',
                  'outline-none hover:bg-surface-hover hover:text-fg',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                  open && 'bg-accent-soft text-accent-fg',
                )}
                aria-expanded={open}
                aria-haspopup="dialog"
                title={m.sidebar.appMenuAria}
                aria-label={m.sidebar.appMenuAria}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.9375rem] font-semibold leading-tight text-fg">{m.appBrand}</div>
                  <div className="truncate text-[0.8125rem] text-fg-muted">{m.appearanceSettings.quickMenuHint}</div>
                </div>
                <Settings className="size-[18px] shrink-0" strokeWidth={1.5} />
              </button>
            </Popover.Trigger>
          </div>
        )}

        <Popover.Portal>
          <Popover.Content
            className={cn(
              'z-50 w-max max-w-[min(calc(100vw-1rem),28rem)] overflow-visible',
              'rounded-xl border border-edge bg-surface-overlay p-2 shadow-popover dark:border-edge',
            )}
            side="top"
            align={collapsed ? 'center' : 'end'}
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <SidebarAppMenu
              onNavigate={() => {
                setOpen(false);
                onNavigate?.();
              }}
              onAboutClick={() => {
                setAboutOpen(true);
                setOpen(false);
              }}
              onSupportClick={() => {
                setOpen(false);
                openSupportReport();
              }}
              onDeviceConnectClick={() => {
                setOpen(false);
                setPairingDialog({ open: true });
              }}
              deviceSummary={deviceSummary}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
