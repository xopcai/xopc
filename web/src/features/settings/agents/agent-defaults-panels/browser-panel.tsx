import { Globe } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName, selectClassName } from '../defaults-field-styles';

export function AgentDefaultsBrowserPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;

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
                <option value="local">{a.browserCloudProviderLocal}</option>
                <option value="browserbase">{a.browserCloudProviderBrowserbase}</option>
                <option value="browser-use">{a.browserCloudProviderBrowserUse}</option>
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
