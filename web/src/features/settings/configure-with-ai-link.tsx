/**
 * "Configure with AI" — opens chat in a new session with the matching setup
 * skill seeded into the composer (`/chat/new?skill=<skill-id>`).
 *
 * The chat-page already supports `?skill=` to drop a `/skill:<id> ` wire
 * token into the composer; the setup skills (M2) carry the dialogue logic.
 *
 * Dropping this button on each settings panel lets users swap out of the
 * form into a guided dialogue without losing context — the agent walks them
 * through the setup and ends up calling the same `xopc <domain> ...` CLI
 * the form would have invoked.
 */

import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export interface ConfigureWithAILinkProps {
  /**
   * Skill id to load into the composer (typically `configure-xopc` for
   * all setup domains — providers, channels, voice, search, etc.).
   * Must match an installed skill — otherwise the chat-page strips the
   * query param without effect.
   */
  skill: string;
  /** Optional setup domain hint appended to the composer seed (e.g. `providers`). */
  domain?: 'providers' | 'channels' | 'voice' | 'search' | 'mcp' | 'heartbeat' | 'agents';
  /** Visual size hint. `sm` matches in-header buttons; `md` is a stand-alone CTA. */
  size?: 'sm' | 'md';
  className?: string;
}

export function ConfigureWithAILink({ skill, domain, size = 'sm', className }: ConfigureWithAILinkProps) {
  const language = useLocaleStore((s) => s.language);
  const c = messages(language).configureWithAi;
  const params = new URLSearchParams({ skill });
  if (domain) params.set('domain', domain);
  const href = `/chat/new?${params.toString()}`;

  const padX = size === 'md' ? 'px-3' : 'px-2.5';
  const padY = size === 'md' ? 'py-2' : 'py-1.5';
  const text = size === 'md' ? 'text-sm' : 'text-xs';

  return (
    <Link
      to={href}
      title={c.tooltip}
      aria-label={c.title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge font-medium text-fg',
        padX,
        padY,
        text,
        'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
    >
      <Sparkles className="size-3.5 text-accent" aria-hidden />
      <span>{c.label}</span>
    </Link>
  );
}
