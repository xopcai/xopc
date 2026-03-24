import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import { cn } from '@/lib/cn';
import { type ThemePreference, useThemeStore } from '@/stores/theme-store';

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <div className={segmentedTrackClassName} role="group" aria-label="Color theme">
      {options.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          aria-pressed={preference === value}
          aria-label={label}
          onClick={() => setPreference(value)}
          className={cn(
            segmentedThumbBaseClassName,
            'size-7 p-0',
            preference === value && segmentedThumbActiveClassName,
            preference === value && 'text-accent-fg hover:text-accent-fg',
          )}
        >
          <Icon className="size-3.5" strokeWidth={1.5} />
        </Button>
      ))}
    </div>
  );
}
