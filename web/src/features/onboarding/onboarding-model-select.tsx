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
      {models
        .slice()
        .sort((a, b) => {
          if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
          return (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' });
        })
        .map((mod) => {
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
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                <span>{mod.name || mod.id}</span>
                {mod.recommended ? (
                  <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg">
                    Recommended
                  </span>
                ) : null}
              </span>
              <span className="block text-xs text-fg-muted">{mod.id}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
