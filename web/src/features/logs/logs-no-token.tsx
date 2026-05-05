import { Terminal } from 'lucide-react';

import type { LogsMessages } from '@/i18n/messages';

type Props = { L: LogsMessages };

export function LogsNoToken({ L }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
      <div className="flex items-start gap-3 rounded-2xl border border-edge-subtle bg-surface-base p-6 dark:border-edge">
        <Terminal className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
        <div>
          <h1 className="text-base font-semibold tracking-tight text-fg">{L.title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">{L.needToken}</p>
        </div>
      </div>
    </div>
  );
}
