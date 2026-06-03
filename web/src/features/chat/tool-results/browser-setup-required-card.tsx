import { Cloud, Globe, MonitorPlay, Puzzle, ShieldHalf, Terminal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { BrowserSetupRequiredPayload } from '@/features/chat/tool-results/browser-setup-required-parser';
import { useLocaleStore } from '@/stores/locale-store';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

const BACKEND_ICON = {
  extension: Puzzle,
  local: MonitorPlay,
  cloakbrowser: ShieldHalf,
  cdp: Terminal,
  cloud: Cloud,
} as const;

export function BrowserSetupRequiredCard({ payload }: { payload: BrowserSetupRequiredPayload }) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;

  const Icon = BACKEND_ICON[payload.backend] ?? Globe;
  const title = m.browserSetupRequiredTitle;
  const reasonCopy = m.browserSetupRequiredReasons[payload.reason] ?? m.browserSetupRequiredReasons.generic;

  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        'mt-2 flex flex-col gap-2 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3 py-3',
        'dark:border-amber-500/30 dark:bg-amber-500/10',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
          )}
          aria-hidden
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/80">
            {reasonCopy}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="primary"
          className="h-8 px-3 py-1.5 text-xs"
          onClick={() => navigate(payload.deepLink)}
        >
          {m.browserSetupRequiredCta}
        </Button>
      </div>
      {payload.detail ? (
        <details className="group min-w-0 text-xs">
          <summary className="cursor-pointer select-none text-amber-800/80 underline-offset-2 hover:text-amber-900 dark:text-amber-200/80 dark:hover:text-amber-100">
            {m.browserSetupRequiredDetailToggle}
          </summary>
          <pre className="mt-2 max-h-40 w-full min-w-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md bg-amber-100/60 p-2 font-mono text-[11px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-100 [overflow-wrap:anywhere]">
            {payload.detail}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
