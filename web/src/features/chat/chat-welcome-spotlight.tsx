import { FileBarChart, FolderOpen, Globe, MessageCircle, StickyNote } from 'lucide-react';
import { memo, useId, useMemo, useState } from 'react';

import { BrandLogo } from '@/components/shell/brand-logo';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

const categoryIcons = {
  folder: FolderOpen,
  content: StickyNote,
  documents: FileBarChart,
  globe: Globe,
} as const;

type CategoryIconKey = keyof typeof categoryIcons;

function CategoryIcon({ name }: { name: string }) {
  const Icon = categoryIcons[name as CategoryIconKey] ?? FolderOpen;
  return <Icon className="size-[1.125rem] text-accent-fg sm:size-5" strokeWidth={1.75} aria-hidden />;
}

export const ChatWelcomeSpotlight = memo(function ChatWelcomeSpotlight({
  chat,
  onPickPrompt,
}: {
  chat: ChatMessages;
  onPickPrompt: (text: string) => void;
}) {
  const s = chat.welcomeSpotlight;
  const panelId = useId();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const selectedCategory = useMemo(
    () => s?.categories.find((c) => c.id === selectedCategoryId),
    [s, selectedCategoryId],
  );

  if (!s) return null;

  return (
    <div className="flex flex-col gap-3.5 pb-2 sm:gap-4 sm:pb-3">
      <div className="flex flex-col items-center gap-1.5 px-1 pt-8 text-center sm:gap-2 sm:pt-10">
        <BrandLogo className="size-12 shrink-0 sm:size-14" aria-hidden />
        <h1 className="text-balance text-lg font-semibold tracking-tight text-fg sm:text-xl">{s.headline}</h1>
        <p className="max-w-md text-pretty text-sm leading-snug text-fg-muted sm:text-[0.9375rem]">{s.tagline}</p>
      </div>

      <div className="mt-10 grid w-full grid-cols-1 gap-2 sm:mt-12 sm:grid-cols-2 sm:gap-2.5 lg:grid-cols-4">
        {s.categories.map((cat) => {
          const expanded = selectedCategoryId === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              onClick={() => setSelectedCategoryId((prev) => (prev === cat.id ? null : cat.id))}
              className={cn(
                'flex flex-row items-start gap-2.5 rounded-xl border bg-surface-panel p-2.5 text-left shadow-surface sm:flex-col sm:gap-2',
                interaction.transition,
                interaction.press,
                interaction.focusRingPanel,
                expanded
                  ? 'border-accent ring-1 ring-accent/25'
                  : 'border-edge hover:border-edge-strong hover:bg-surface-hover/40 dark:hover:bg-surface-hover/30',
              )}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft sm:size-10">
                <CategoryIcon name={cat.icon} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-snug text-fg sm:text-[0.9375rem]">{cat.title}</div>
                <div className="mt-0.5 text-xs leading-snug text-fg-muted sm:text-sm">{cat.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedCategory && selectedCategory.scenarios.length > 0 ? (
        <div
          id={panelId}
          role="region"
          aria-label={selectedCategory.title}
          className="flex flex-col gap-1.5 rounded-xl border border-edge bg-surface-base/80 p-2.5 dark:bg-surface-hover/20"
        >
          <ul className="flex flex-col gap-1">
            {selectedCategory.scenarios.map((ex) => (
              <li key={ex.prompt}>
                <button
                  type="button"
                  onClick={() => onPickPrompt(ex.prompt)}
                  className={cn(
                    'flex w-full gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-sm leading-snug text-fg',
                    interaction.transition,
                    interaction.press,
                    interaction.focusRingPanel,
                    'hover:border-edge hover:bg-surface-panel dark:hover:bg-surface-panel/40',
                  )}
                >
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-accent-fg" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1 text-pretty">{ex.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
});
