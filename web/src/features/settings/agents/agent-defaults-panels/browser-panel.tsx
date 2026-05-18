import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Plug, PlugZap, Unplug } from 'lucide-react';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { MessageBundle } from '@/i18n/messages';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName, selectClassName } from '../defaults-field-styles';

type ExtensionStatusMessages = Pick<
  MessageBundle['agentSettings'],
  'browserExtensionConnected' | 'browserExtensionWaiting' | 'browserExtensionServerOff'
>;

type ExtensionStatus = 'connected' | 'waiting' | 'off' | 'unknown';

/** Poll gateway for extension connection status via `/api/browser/extension-status`. */
function useExtensionStatus(
  enabled: boolean,
  host: string,
  port: number | undefined,
): ExtensionStatus {
  const [status, setStatus] = useState<ExtensionStatus>(enabled ? 'unknown' : 'off');
  const trackedEnabledRef = useRef(enabled);
  if (trackedEnabledRef.current !== enabled) {
    trackedEnabledRef.current = enabled;
    setStatus(enabled ? 'unknown' : 'off');
  }

  const checkStatus = useCallback(async () => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    const params = new URLSearchParams({ probe: '1' });
    if (host) params.set('host', host);
    if (port !== undefined) params.set('port', String(port));
    try {
      const res = await apiFetch(apiUrl(`/api/browser/extension-status?${params}`), {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        setStatus('off');
        return;
      }
      const data = (await res.json()) as { running?: boolean; connected?: boolean };
      if (data.running) {
        setStatus(data.connected ? 'connected' : 'waiting');
      } else {
        setStatus('off');
      }
    } catch {
      setStatus('off');
    }
  }, [enabled, host, port]);

  useEffect(() => {
    void checkStatus();
    const interval = setInterval(() => void checkStatus(), 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return status;
}

function ExtensionStatusBadge({ status, messages }: { status: ExtensionStatus; messages: ExtensionStatusMessages }) {
  const config: Record<ExtensionStatus, { icon: typeof Plug; color: string; label: string }> = {
    connected: { icon: PlugZap, color: 'text-green-500', label: messages.browserExtensionConnected },
    waiting: { icon: Plug, color: 'text-amber-500', label: messages.browserExtensionWaiting },
    off: { icon: Unplug, color: 'text-fg-muted', label: messages.browserExtensionServerOff },
    unknown: { icon: Unplug, color: 'text-fg-muted', label: '…' },
  };
  const { icon: Icon, color, label } = config[status];
  return (
    <div className={`flex items-center gap-1.5 text-xs ${color}`}>
      <Icon className="size-3.5" />
      <span>{label}</span>
    </div>
  );
}

export function AgentDefaultsBrowserPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;

  const extensionStatus = useExtensionStatus(
    form.browserBackend === 'extension',
    form.browserExtensionHost,
    form.browserExtensionPort,
  );

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Globe} title={a.cardBrowserTitle} subtitle={a.cardBrowserSubtitle} />
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <AgentDefaultsField label={a.label.browserEnabled} description={a.desc.browserEnabled}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserEnabled}
                  onChange={(e) => update({ browserEnabled: e.target.checked })}
                />
                <span>{a.browserEnabledOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserHeadless} description={a.desc.browserHeadless}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserHeadless}
                  onChange={(e) => update({ browserHeadless: e.target.checked })}
                />
                <span>{a.browserHeadlessOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserAllowPrivateUrls} description={a.desc.browserAllowPrivateUrls}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserAllowPrivateUrls}
                  onChange={(e) => update({ browserAllowPrivateUrls: e.target.checked })}
                />
                <span>{a.browserAllowPrivateOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserCommandTimeout} description={a.desc.browserCommandTimeout}>
              <input
                type="number"
                className={inputClassName()}
                min={5}
                value={form.browserCommandTimeout ?? ''}
                placeholder="30"
                onChange={(e) => {
                  const v = e.target.value;
                  update({ browserCommandTimeout: v === '' ? undefined : Number.parseInt(v, 10) });
                }}
              />
            </AgentDefaultsField>
          </div>

          {/* Backend mode selector */}
          <div className="grid gap-5 sm:grid-cols-2">
            <AgentDefaultsField label={a.label.browserBackend} description={a.desc.browserBackend}>
              <select
                className={selectClassName()}
                value={form.browserBackend}
                onChange={(e) =>
                  update({ browserBackend: e.target.value as 'local' | 'cdp' | 'cloud' | 'extension' })
                }
              >
                <option value="local">{a.browserBackendLocal}</option>
                <option value="cdp">{a.browserBackendCdp}</option>
                <option value="cloud">{a.browserBackendCloud}</option>
                <option value="extension">{a.browserBackendExtension}</option>
              </select>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserDialogPolicy} description={a.desc.browserDialogPolicy}>
              <select
                className={selectClassName()}
                value={form.browserDialogPolicy}
                onChange={(e) =>
                  update({
                    browserDialogPolicy: e.target.value as
                      | 'must_respond'
                      | 'auto_dismiss'
                      | 'auto_accept',
                  })
                }
              >
                <option value="must_respond">{a.browserDialogPolicyMustRespond}</option>
                <option value="auto_dismiss">{a.browserDialogPolicyAutoDismiss}</option>
                <option value="auto_accept">{a.browserDialogPolicyAutoAccept}</option>
              </select>
            </AgentDefaultsField>
          </div>

          {/* Conditional fields based on backend mode */}
          {form.browserBackend === 'cloud' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <AgentDefaultsField label={a.label.browserCloudProvider} description={a.desc.browserCloudProvider}>
                <select
                  className={selectClassName()}
                  value={form.browserCloudProvider}
                  onChange={(e) =>
                    update({
                      browserCloudProvider: e.target.value as 'local' | 'browserbase' | 'browser-use',
                    })
                  }
                >
                  <option value="browserbase">{a.browserCloudProviderBrowserbase}</option>
                  <option value="browser-use">{a.browserCloudProviderBrowserUse}</option>
                </select>
              </AgentDefaultsField>
            </div>
          )}

          {form.browserBackend === 'cdp' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <AgentDefaultsField label={a.label.browserCdpUrl} description={a.desc.browserCdpUrl}>
                <input
                  type="text"
                  className={inputClassName()}
                  value={form.browserCdpUrl}
                  placeholder="ws://localhost:9222"
                  onChange={(e) => update({ browserCdpUrl: e.target.value })}
                  autoComplete="off"
                />
              </AgentDefaultsField>
            </div>
          )}

          {form.browserBackend === 'extension' && (
            <div className="flex items-center gap-3 rounded-md border border-edge bg-surface-raised px-4 py-3">
              <ExtensionStatusBadge status={extensionStatus} messages={a} />
              <span className="text-xs text-fg-muted">ws://127.0.0.1:19820/browser-ext</span>
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <AgentDefaultsField label={a.label.browserDialogTimeout} description={a.desc.browserDialogTimeout}>
              <input
                type="number"
                className={inputClassName()}
                min={1}
                value={form.browserDialogTimeout ?? ''}
                placeholder="300"
                onChange={(e) => {
                  const v = e.target.value;
                  update({ browserDialogTimeout: v === '' ? undefined : Number.parseInt(v, 10) });
                }}
              />
            </AgentDefaultsField>
          </div>
        </div>
      </SettingsFormSection>
    </div>
  );
}
