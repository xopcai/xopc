import { Button } from '@/components/ui/button';
import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

const labels: Record<'en' | 'zh', string> = { en: 'EN', zh: '中文' };

export function LanguageToggle() {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);

  return (
    <div className={segmentedTrackClassName} role="group" aria-label="Language">
      {(['en', 'zh'] as const).map((lang) => (
        <Button
          key={lang}
          type="button"
          variant="ghost"
          aria-pressed={language === lang}
          aria-label={lang === 'en' ? 'English' : '中文'}
          onClick={() => setLanguage(lang)}
          className={cn(
            segmentedThumbBaseClassName,
            'h-7 min-w-9 px-2 py-0',
            language === lang && segmentedThumbActiveClassName,
            language === lang && 'text-fg hover:text-fg',
          )}
        >
          {labels[lang]}
        </Button>
      ))}
    </div>
  );
}
