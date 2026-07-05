import { ShieldAlert, SlidersHorizontal } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '.././browser-settings-field';
import { inputClassName, selectClassName } from '../../agents/defaults-field-styles';
import type { AgentDefaultsPanelProps } from '.././browser-settings-panel-props';

import { browserFocusElementId } from './browser-focus';
import { Select, SelectOption } from '@/components/ui/popover-select';

export function BrowserBehaviorSections({
  a,
  form,
  update,
}: Pick<AgentDefaultsPanelProps, 'a' | 'form' | 'update'>) {
  return (
    <div className="flex flex-col gap-5">
      <div id={browserFocusElementId('runtime')} className="scroll-mt-24">
        <SettingsFormSection>
          <SettingsFormSectionHeader icon={SlidersHorizontal} title={a.browserBehaviorShow} />
        <div className="grid gap-5 sm:grid-cols-2">
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
          <AgentDefaultsField label={a.label.browserDialogPolicy} description={a.desc.browserDialogPolicy}>
            <Select
              className={selectClassName()}
              value={form.browserDialogPolicy}
              onChange={(e) =>
                update({
                  browserDialogPolicy: e.target.value as 'must_respond' | 'auto_dismiss' | 'auto_accept',
                })
              }
            >
              <SelectOption value="must_respond">{a.browserDialogPolicyMustRespond}</SelectOption>
              <SelectOption value="auto_dismiss">{a.browserDialogPolicyAutoDismiss}</SelectOption>
              <SelectOption value="auto_accept">{a.browserDialogPolicyAutoAccept}</SelectOption>
            </Select>
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
        </SettingsFormSection>
      </div>

      <div id={browserFocusElementId('security')} className="scroll-mt-24">
        <SettingsFormSection className="border border-amber-500/20">
          <SettingsFormSectionHeader icon={ShieldAlert} title={a.browserSecurityShow} />
        <div className="grid gap-5 sm:grid-cols-2">
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
        </SettingsFormSection>
      </div>
    </div>
  );
}
