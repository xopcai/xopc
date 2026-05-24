import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import {
  dismissScenarioPresets,
  readScenarioPresetsDismissed,
  SCENARIO_PRESETS,
  type ScenarioPresetStep,
} from './scenario-presets';

function stepLabel(
  step: ScenarioPresetStep,
  steps: Record<string, string>,
): string {
  return steps[step.labelKey] ?? step.labelKey;
}

export function SetupScenarioPresets() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const s = m.setupStatus.scenarios;
  const [dismissed, setDismissed] = useState(readScenarioPresetsDismissed);

  if (dismissed) return null;

  return (
    <SettingsFormSection>
      <div className="flex items-start justify-between gap-3">
        <SettingsFormSectionHeader icon={Sparkles} title={s.title} subtitle={s.subtitle} />
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-fg-muted',
            'hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
          onClick={() => {
            dismissScenarioPresets();
            setDismissed(true);
          }}
        >
          <X className="size-3.5" aria-hidden />
          {s.dismiss}
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {SCENARIO_PRESETS.map((preset) => {
          const copy = s.presets[preset.id];
          return (
            <article
              key={preset.id}
              className="flex flex-col rounded-xl border border-edge-subtle bg-surface-panel p-4"
            >
              <h3 className="text-sm font-semibold text-fg">{copy.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{copy.description}</p>
              <ol className="mt-3 flex flex-col gap-1">
                {preset.steps.map((step, index) => (
                  <li key={`${preset.id}-${step.labelKey}`}>
                    <Link
                      to={step.path}
                      className={cn(
                        'text-xs font-medium text-accent-fg hover:underline',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded',
                      )}
                    >
                      {index + 1}. {stepLabel(step, s.steps)}
                    </Link>
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>
    </SettingsFormSection>
  );
}
