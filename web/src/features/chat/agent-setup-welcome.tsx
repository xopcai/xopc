import { MessageCircleMore, Settings2, Sparkles } from 'lucide-react';

import type { AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

const promptIcons = [Sparkles, Settings2, MessageCircleMore] as const;

export function AgentSetupWelcome({
  agentName,
  messages,
  disabled,
  onPick,
}: {
  agentName: string;
  messages: AgentsSettingsMessages;
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  const prompts = [messages.setupPromptIdentity, messages.setupPromptProject, messages.setupPromptComplete];

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-2 pb-4 pt-12 text-center sm:pt-16" aria-labelledby="agent-setup-title">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Sparkles className="size-6" strokeWidth={1.75} aria-hidden />
      </div>
      <h1 id="agent-setup-title" className="mt-4 text-balance text-xl font-semibold tracking-tight text-fg">
        {messages.setupTitle}
      </h1>
      <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-muted">
        {messages.setupDescription.replace('{{name}}', agentName)}
      </p>
      <div className="mt-7 grid w-full gap-3 md:grid-cols-3">
        {prompts.map((prompt, index) => {
          const Icon = promptIcons[index] ?? Sparkles;
          return (
            <button
              key={prompt}
              type="button"
              disabled={disabled}
              onClick={() => onPick(prompt)}
              className={cn(
                'flex min-h-24 items-center gap-3 rounded-xl border border-edge bg-surface-panel px-4 py-4 text-left text-sm font-medium leading-relaxed text-fg',
                'hover:border-accent/30 hover:bg-surface-hover',
                interaction.transition,
                interaction.pressCard,
                interaction.focusRingPanel,
                interaction.disabled,
              )}
            >
              <Icon className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
              <span>{prompt}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
