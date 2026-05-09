import { Clock } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName } from '../defaults-field-styles';

export function AgentDefaultsExpertPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;
  const x = a.advanced;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Clock} title={x.cardParamsTitle} subtitle={x.cardParamsSubtitle} />
        <AgentDefaultsField label={x.paramsJson} description={x.paramsJsonDesc}>
          <textarea
            className={cn(inputClassName(), 'min-h-[88px] resize-y font-mono text-xs')}
            value={form.paramsJson}
            placeholder="{}"
            onChange={(e) => update({ paramsJson: e.target.value })}
          />
        </AgentDefaultsField>
      </SettingsFormSection>
    </div>
  );
}
