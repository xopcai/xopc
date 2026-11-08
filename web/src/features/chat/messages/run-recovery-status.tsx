import { RefreshCw } from 'lucide-react';

import type { ProgressState } from './messages.types';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function RunRecoveryStatus({ progress }: { progress: ProgressState }) {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).chat.runRecovery;
  return <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 py-2 text-xs text-fg-muted" data-run-recovery>
    <RefreshCw className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
    <span>{progress.stage === 'model_fallback' ? t.fallback : t.retrying}</span>
    {progress.completed != null && progress.total != null ? <span className="tabular-nums">
      {t.attempt.replace('{{attempt}}', String(progress.completed)).replace('{{total}}', String(progress.total))}
    </span> : null}
  </div>;
}
