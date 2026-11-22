import { RotateCcw, Settings, Check } from 'lucide-react';
import { useState } from 'react';
import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type ConfigChangePresentation = Extract<
  NonNullable<ProductDeliveryEnvelope['presentation']>,
  { kind: 'config_change' }
>;

export function ConfigChangeCard({
  presentation,
  language,
}: {
  presentation: ConfigChangePresentation;
  language: 'en' | 'zh';
}) {
  const zh = language === 'zh';
  const [rollingBack, setRollingBack] = useState(false);
  const [rolledBack, setRolledBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRollback = async () => {
    if (rollingBack || rolledBack) return;
    setRollingBack(true);
    setError(null);
    try {
      await fetchJson(apiUrl(`/api/self-config/changes/${encodeURIComponent(presentation.changeId)}/rollback`), {
        method: 'POST',
      });
      setRolledBack(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? '撤销失败' : 'Rollback failed'));
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <li className="min-w-0 max-w-full rounded-xl border border-edge bg-surface-subtle/60 px-3.5 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Settings className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
          <span className="truncate font-medium text-fg">{presentation.title}</span>
          <span className="shrink-0 rounded-md border border-edge px-1.5 py-0.5 text-[10px] text-fg-muted">
            {zh ? `分级 T${presentation.tier}` : `Tier ${presentation.tier}`}
          </span>
        </div>
        {presentation.canRollback ? (
          rolledBack ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-fg-muted">
              <Check className="size-3" aria-hidden />
              {zh ? '已撤销' : 'Rolled back'}
            </span>
          ) : (
            <Button
              variant="ghost"
              className="h-7 shrink-0 gap-1 px-2 text-[11px]"
              disabled={rollingBack}
              onClick={() => { void handleRollback(); }}
            >
              <RotateCcw className="size-3" aria-hidden />
              {rollingBack ? (zh ? '撤销中…' : 'Undoing…') : (zh ? '撤销' : 'Undo')}
            </Button>
          )
        ) : null}
      </div>
      {presentation.changes.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-edge/60 pt-2 text-[11px] text-fg-muted">
          {presentation.changes.map((item) => (
            <li key={item.field} className="flex flex-wrap items-baseline gap-1.5">
              <code className="font-mono text-fg">{item.field}</code>
              <span>{item.before ?? '—'}</span>
              <span aria-hidden>→</span>
              <span className="font-medium text-fg">{item.after ?? '—'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className="mt-1.5 text-[11px] text-danger">{error}</p> : null}
    </li>
  );
}
