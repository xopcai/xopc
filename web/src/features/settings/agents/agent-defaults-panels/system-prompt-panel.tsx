import { ScrollText } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName } from '../defaults-field-styles';

export function AgentDefaultsSystemPromptPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;
  const x = a.advanced;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={ScrollText}
          title={x.cardSystemPromptTitle}
          subtitle={x.cardSystemPromptSubtitle}
        />
        <AgentDefaultsField label={x.systemPromptOverride} description={x.systemPromptOverrideDesc}>
          <textarea
            className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
            value={form.systemPromptOverride}
            placeholder={x.systemPromptPlaceholder}
            onChange={(e) => update({ systemPromptOverride: e.target.value })}
          />
        </AgentDefaultsField>
      </SettingsFormSection>
    </div>
  );
}
