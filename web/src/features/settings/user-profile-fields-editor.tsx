import { useMemo, useState } from 'react';

import { Select, SelectOption } from '@/components/ui/popover-select';
import {
  detectBrowserTimezone,
  PRONOUNS_PRESETS,
  TIMEZONE_OPTIONS,
  type UserFields,
} from '@/features/settings/agents/agent-profile-markdown';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export type UserProfileFieldsEditorLabels = {
  callName: string;
  callNamePlaceholder: string;
  pronouns: string;
  pronounsPlaceholder: string;
  timezone: string;
  timezoneCustom: string;
  timezoneDetect: string;
  custom: string;
  notes: string;
  notesPlaceholder: string;
};

export function UserProfileFieldsEditor({
  value,
  onChange,
  labels,
  language,
  inputClassName,
}: {
  value: UserFields;
  onChange: (value: UserFields) => void;
  labels: UserProfileFieldsEditorLabels;
  language: 'en' | 'zh';
  inputClassName: string;
}) {
  const [customTimezone, setCustomTimezone] = useState(() => (
    TIMEZONE_OPTIONS.some((timezone) => timezone.value === value.timezone) ? '' : value.timezone
  ));
  const [showCustomTimezone, setShowCustomTimezone] = useState(() => (
    Boolean(value.timezone) && !TIMEZONE_OPTIONS.some((timezone) => timezone.value === value.timezone)
  ));
  const [showCustomPronouns, setShowCustomPronouns] = useState(() => (
    Boolean(value.pronouns) && !PRONOUNS_PRESETS.some((preset) => preset.value === value.pronouns)
  ));

  const timezoneSelectValue = useMemo(() => {
    if (showCustomTimezone) return '__custom__';
    return TIMEZONE_OPTIONS.some((timezone) => timezone.value === value.timezone)
      ? value.timezone
      : '__custom__';
  }, [showCustomTimezone, value.timezone]);

  const update = (patch: Partial<UserFields>) => onChange({ ...value, ...patch });
  const localizedLabel = (en: string, zh: string) => language === 'zh' ? zh : en;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-fg">{labels.callName}</span>
        <input
          className={inputClassName}
          value={value.callName}
          onChange={(event) => update({ callName: event.target.value })}
          placeholder={labels.callNamePlaceholder}
          autoComplete="off"
        />
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-fg">{labels.pronouns}</span>
        <Select
          className={inputClassName}
          value={showCustomPronouns ? '__custom__' : value.pronouns}
          onChange={(event) => {
            if (event.target.value === '__custom__') {
              setShowCustomPronouns(true);
              if (PRONOUNS_PRESETS.some((preset) => preset.value === value.pronouns)) update({ pronouns: '' });
              return;
            }
            setShowCustomPronouns(false);
            update({ pronouns: event.target.value });
          }}
        >
          <SelectOption value="">{labels.pronounsPlaceholder}</SelectOption>
          {PRONOUNS_PRESETS.map((preset) => (
            <SelectOption key={preset.value} value={preset.value}>
              {localizedLabel(preset.labelEn, preset.labelZh)}
            </SelectOption>
          ))}
          <SelectOption value="__custom__">{labels.custom}</SelectOption>
        </Select>
        {showCustomPronouns ? (
          <input
            className={cn(inputClassName, 'mt-1 text-xs')}
            value={value.pronouns}
            onChange={(event) => update({ pronouns: event.target.value })}
            placeholder={labels.pronounsPlaceholder}
            autoComplete="off"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
        <span className="font-medium text-fg">{labels.timezone}</span>
        <div className="flex flex-wrap items-stretch gap-2">
          <Select
            className={cn(inputClassName, 'min-w-0 flex-1')}
            value={timezoneSelectValue}
            onChange={(event) => {
              if (event.target.value === '__custom__') {
                setShowCustomTimezone(true);
                return;
              }
              setShowCustomTimezone(false);
              setCustomTimezone('');
              update({ timezone: event.target.value });
            }}
          >
            {TIMEZONE_OPTIONS.map((timezone) => (
              <SelectOption key={timezone.value} value={timezone.value}>
                {localizedLabel(timezone.labelEn, timezone.labelZh)}
              </SelectOption>
            ))}
            <SelectOption value="__custom__">{labels.timezoneCustom}</SelectOption>
          </Select>
          <button
            type="button"
            className={cn(
              'shrink-0 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
              interaction.press,
            )}
            onClick={() => {
              const detected = detectBrowserTimezone();
              if (!detected) return;
              const known = TIMEZONE_OPTIONS.some((timezone) => timezone.value === detected);
              setShowCustomTimezone(!known);
              setCustomTimezone(known ? '' : detected);
              update({ timezone: detected });
            }}
          >
            {labels.timezoneDetect}
          </button>
        </div>
        {showCustomTimezone ? (
          <input
            className={cn(inputClassName, 'mt-1 font-mono text-xs')}
            value={customTimezone}
            onChange={(event) => {
              setCustomTimezone(event.target.value);
              update({ timezone: event.target.value });
            }}
            placeholder="e.g. Asia/Shanghai"
            autoComplete="off"
          />
        ) : null}
      </div>

      <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
        <span className="font-medium text-fg">{labels.notes}</span>
        <textarea
          className={cn(inputClassName, 'min-h-28 resize-y text-sm leading-relaxed')}
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
          placeholder={labels.notesPlaceholder}
          rows={5}
          spellCheck
        />
      </label>
    </div>
  );
}
