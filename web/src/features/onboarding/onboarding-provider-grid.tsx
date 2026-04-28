import { cn } from '@/lib/cn';

import { ProviderLogo } from '@/features/onboarding/provider-icons';

export const ONBOARDING_FEATURED_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', recommended: true },
  { id: 'minimax', name: 'MiniMax', recommended: false },
  { id: 'kimi-coding', name: 'Kimi Coding', recommended: false },
  { id: 'openai', name: 'OpenAI', recommended: false },
  { id: 'anthropic', name: 'Anthropic', recommended: false },
  { id: 'google', name: 'Google AI', recommended: false },
] as const;

export function OnboardingProviderGrid({
  onSelect,
}: {
  onSelect: (providerId: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {ONBOARDING_FEATURED_PROVIDERS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          className={cn(
            'relative flex flex-col items-center gap-1.5 rounded-xl border border-edge p-4 text-center transition-colors',
            'hover:border-accent hover:bg-accent-soft',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            p.recommended && 'border-accent/50 bg-accent-soft/30',
          )}
        >
          {p.recommended && (
            <span className="absolute -top-2 right-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
              推荐
            </span>
          )}
          <ProviderLogo providerId={p.id} className="size-8" />
          <span className="text-sm font-medium text-fg">{p.name}</span>
        </button>
      ))}
    </div>
  );
}
