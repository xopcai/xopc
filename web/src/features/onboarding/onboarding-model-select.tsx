import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { cn } from '@/lib/cn';

export function OnboardingModelSelect({
  models,
  selectedId,
  onSelectedChange,
}: {
  models: ConfiguredModel[];
  selectedId: string | null;
  onSelectedChange: (id: string) => void;
}) {
  if (models.length === 0) {
    return null;
  }

  return (
    <div className="flex max-h-[min(50vh,22rem)] flex-col gap-2 overflow-y-auto pr-1" role="radiogroup">
      {models.map((mod) => {
        const checked = selectedId === mod.id;
        return (
          <label
            key={mod.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border border-edge px-3 py-2.5 transition-colors',
              checked ? 'border-accent bg-accent-soft' : 'hover:bg-surface-hover',
            )}
          >
            <input
              type="radio"
              name="onboarding-model"
              className="mt-1"
              checked={checked}
              onChange={() => onSelectedChange(mod.id)}
              aria-label={mod.name || mod.id}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg">{mod.name || mod.id}</span>
              <span className="block text-xs text-fg-muted">{mod.id}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
