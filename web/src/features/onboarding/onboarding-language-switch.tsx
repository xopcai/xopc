import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';

const LANGUAGES: readonly { value: StoredLanguage; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'zh', label: '中文' },
];

export function OnboardingLanguageSwitch({
  value,
  onChange,
}: {
  value: StoredLanguage;
  onChange: (language: StoredLanguage) => void;
}) {
  return (
    <div className={segmentedTrackClassName} role="group" aria-label="Language / 语言">
      {LANGUAGES.map((language) => {
        const selected = language.value === value;
        return (
          <button
            key={language.value}
            type="button"
            aria-pressed={selected}
            className={cn(
              segmentedThumbBaseClassName,
              'h-9 min-w-11 px-2',
              selected ? cn(segmentedThumbActiveClassName, 'text-fg') : 'text-fg-subtle hover:text-fg',
            )}
            onClick={() => onChange(language.value)}
          >
            {language.label}
          </button>
        );
      })}
    </div>
  );
}
