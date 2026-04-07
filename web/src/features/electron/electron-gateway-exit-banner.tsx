import { useEffect, useState } from 'react';

import { isElectron } from '@/lib/electron-env';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

/** Shown when the embedded gateway child process exits unexpectedly (Electron packaged app). */
export function ElectronGatewayExitBanner() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).electron;

  const [detail, setDetail] = useState<{ code: number | null; signal: string | null } | null>(null);

  useEffect(() => {
    if (!isElectron()) return;
    const api = window.electronAPI?.gateway;
    if (!api?.onExited) return;
    return api.onExited((d) => setDetail(d));
  }, []);

  if (!detail) return null;

  return (
    <div
      className={cn('shrink-0 border-b border-danger/35 bg-danger/10 px-4 py-3 text-sm text-fg shadow-surface')}
      role="alert"
    >
      <p className="font-semibold">{t.gatewayExitTitle}</p>
      <p className="mt-1 text-fg-muted">{t.gatewayExitBody}</p>
      <p className="mt-2 font-mono text-xs text-fg-muted">
        exit {detail.code ?? '—'} · signal {detail.signal ?? '—'}
      </p>
    </div>
  );
}
