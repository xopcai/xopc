import * as Dialog from '@radix-ui/react-dialog';
import { ShieldOff, X } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { useLocaleStore } from '@/stores/locale-store';
import type { ManagedDevice } from './management-api';
import { managedDeviceStatus, managedDeviceToolCount, shortDeviceId } from './management-model';

export function DeviceDetailDrawer({
  device,
  busy,
  onClose,
  onRevoke,
}: {
  device: ManagedDevice | null;
  busy: boolean;
  onClose: () => void;
  onRevoke: (device: ManagedDevice) => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).endpointToolsSettings;
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    [language],
  );
  const status = device ? managedDeviceStatus(device) : 'offline';

  return (
    <Dialog.Root open={device !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
        <Dialog.Content
          className={cn(
            'xopc-drawer-right fixed right-0 top-0 flex size-full max-w-lg flex-col border-l border-edge bg-surface-overlay shadow-popover outline-none',
            SETTINGS_SHELL_CONTENT_Z,
          )}
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold text-fg">
                {device?.displayName ?? copy.deviceDetails}
              </Dialog.Title>
              {device ? (
                <p className="mt-0.5 text-xs text-fg-muted">
                  {device.kind} · {device.platform} · {shortDeviceId(device.id)}
                </p>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" className="size-9 shrink-0 p-0" aria-label={copy.close}>
                <X className="size-5" aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          {device ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <dl className="grid grid-cols-2 gap-3 rounded-xl bg-surface-hover/40 p-4">
                <Detail label={copy.statusLabel} value={copy.status[status]} />
                <Detail label={copy.lastSeen} value={device.lastSeenAt ? formatter.format(device.lastSeenAt) : copy.never} />
                <Detail label={copy.endpointCount} value={String(device.endpoints.length)} />
                <Detail label={copy.toolCount} value={String(managedDeviceToolCount(device))} />
              </dl>

              <section>
                <h3 className="text-sm font-semibold text-fg">{copy.accessTitle}</h3>
                <div className="mt-2 rounded-xl border border-edge-subtle bg-surface-base p-3 text-xs text-fg-muted">
                  {device.access ? (
                    <>
                      <p>{device.access.revokedAt ? copy.accessRevoked : copy.accessActive}</p>
                      <p className="mt-1 break-words">{copy.permissions}: {device.access.scopes.join(', ') || copy.noPermissions}</p>
                    </>
                  ) : <p>{copy.noAccessIdentity}</p>}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-fg">{copy.endpointsTitle}</h3>
                <div className="mt-2 space-y-2">
                  {device.endpoints.length === 0 ? <p className="text-sm text-fg-muted">{copy.noOnlineEndpoints}</p> : null}
                  {device.endpoints.map((endpoint) => (
                    <article key={endpoint.connectionId} className="rounded-xl border border-edge-subtle bg-surface-base p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-all text-xs font-medium text-fg">{endpoint.endpointId}</p>
                        <span className="text-xs text-fg-muted">{copy.status[endpoint.availability]} · v{endpoint.appVersion}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {endpoint.tools.map(({ descriptor }) => (
                          <div key={descriptor.name} className="rounded-lg bg-surface-hover/50 px-3 py-2">
                            <p className="break-all text-xs font-medium text-fg">{descriptor.name}</p>
                            <p className="mt-0.5 break-words text-xs text-fg-subtle">
                              {descriptor.requiredPermissions.join(', ') || copy.noPermissions}
                            </p>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-fg">{copy.identityTitle}</h3>
                <dl className="mt-2 rounded-xl border border-edge-subtle bg-surface-base p-3 text-xs">
                  <Detail label={copy.identityId} value={device.id} breakAll />
                  <div className="mt-3"><Detail label={copy.createdAt} value={formatter.format(device.createdAt)} /></div>
                </dl>
              </section>
            </div>
          ) : null}

          {device && status !== 'revoked' ? (
            <div className="shrink-0 border-t border-edge px-4 py-3">
              <Button
                variant="secondary"
                className="w-full text-danger"
                disabled={busy}
                onClick={() => onRevoke(device)}
              >
                <ShieldOff className="size-4" aria-hidden />
                {busy ? copy.revoking : copy.removeDevice}
              </Button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Detail({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className={cn('mt-1 text-sm text-fg', breakAll && 'break-all font-mono text-xs')}>{value}</dd>
    </div>
  );
}
