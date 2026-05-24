import { Timer } from 'lucide-react';
import { Link } from 'react-router-dom';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { pathForTab } from '@/navigation';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName } from '../defaults-field-styles';

export function AgentDefaultsLimitsPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;
  const x = a.advanced;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Timer} title={x.cardLimitsTitle} subtitle={x.cardLimitsSubtitle} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={x.maxTaskDurationMs} description={x.maxTaskDurationMsDesc}>
            <input
              type="number"
              className={inputClassName()}
              min={1}
              max={240}
              step={1}
              value={form.maxTaskDurationMinutes ?? ''}
              placeholder={x.maxTaskDurationPlaceholder}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  update({ maxTaskDurationMinutes: undefined });
                  return;
                }
                const num = Number.parseInt(v, 10);
                if (Number.isNaN(num)) {
                  return;
                }
                update({ maxTaskDurationMinutes: Math.min(240, Math.max(1, num)) });
              }}
            />
          </AgentDefaultsField>
          <div className="grid gap-5 sm:grid-cols-2">
            <AgentDefaultsField label={x.maxRequestsPerTurn} description={x.maxRequestsPerTurnDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={10}
                max={200}
                value={form.maxRequestsPerTurn}
                onChange={(e) => update({ maxRequestsPerTurn: Number.parseInt(e.target.value, 10) || 50 })}
              />
            </AgentDefaultsField>
            <AgentDefaultsField label={x.maxToolFailuresPerTurn} description={x.maxToolFailuresPerTurnDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={1}
                max={20}
                value={form.maxToolFailuresPerTurn}
                onChange={(e) => update({ maxToolFailuresPerTurn: Number.parseInt(e.target.value, 10) || 3 })}
              />
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.maxToolIterations} description={a.desc.maxToolIterations}>
              <input
                type="number"
                className={inputClassName()}
                value={form.maxToolIterations}
                min={1}
                onChange={(e) => update({ maxToolIterations: Number.parseInt(e.target.value, 10) || 0 })}
              />
            </AgentDefaultsField>
          </div>
        </div>
      </SettingsFormSection>
      <p className="text-xs text-fg-muted">
        <Link to={pathForTab('cron')} className="font-medium text-accent-fg hover:underline">
          {x.goalsCheckLink}
        </Link>
        <span className="mt-1 block">{x.goalsCheckLinkHint}</span>
      </p>
    </div>
  );
}
