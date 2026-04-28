import { cn } from '@/lib/cn';

export const ONBOARDING_FEATURED_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', icon: '🟢' },
  { id: 'anthropic', name: 'Anthropic', icon: '🟣' },
  { id: 'google', name: 'Google AI', icon: '🔵' },
  { id: 'groq', name: 'Groq', icon: '⚡' },
  { id: 'openrouter', name: 'OpenRouter', icon: '🔀' },
  { id: 'xai', name: 'xAI', icon: '✖' },
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
            'flex flex-col items-center gap-1.5 rounded-xl border border-edge p-4 text-center transition-colors',
            'hover:border-accent hover:bg-accent-soft',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        >
          <span className="text-2xl" aria-hidden>
            {p.icon}
          </span>
          <span className="text-sm font-medium text-fg">{p.name}</span>
        </button>
      ))}
    </div>
  );
}
