import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
    <div
      className="inline-flex rounded-md border border-edge bg-surface-panel p-0.5 dark:border-edge"
      role="group"
      aria-label="Color theme"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          aria-pressed={preference === value}
          aria-label={label}
          onClick={() => setPreference(value)}
          className={cn(
            'h-8 w-8 rounded-sm p-0 text-fg-subtle hover:text-fg',
            preference === value && 'bg-surface-active text-accent-fg',
          )}
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </Button>
      ))}
    </div>
  );
}
