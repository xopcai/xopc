import type { LogEntry } from '@/features/logs/log.types';
import { levelLabel, moduleLabel } from '@/features/logs/logs-page-lib';
import type { LogsMessages } from '@/i18n/messages';

export type LogDetailLabels = Pick<
  LogsMessages,
  'time' | 'level' | 'module' | 'message' | 'metadata' | 'requestId' | 'sessionId'
>;

type Props = {
  log: LogEntry;
  labels: LogDetailLabels;
};

export function LogDetailBody({ log, labels }: Props) {
  const lv = log.level ?? 'info';
  const rid = typeof log.requestId === 'string' ? log.requestId : '';
  const sid = typeof log.sessionId === 'string' ? log.sessionId : '';
  return (
    <div className="flex flex-col gap-8">
      <div>
        <span className="text-xs font-sans font-medium text-fg-muted">{labels.message}</span>
        <pre className="mt-2 whitespace-pre-wrap break-words border border-edge bg-surface-base p-3 text-xs leading-relaxed text-fg dark:border-edge">
          {log.message || '—'}
        </pre>
      </div>
      <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-xs">
        <span className="font-sans text-fg-muted">{labels.time}</span>
        <code className="break-all text-fg">{log.timestamp}</code>
        <span className="font-sans text-fg-muted">{labels.level}</span>
        <span className="text-fg">{levelLabel(lv)}</span>
        <span className="font-sans text-fg-muted">{labels.module}</span>
        <code className="break-all text-fg">{moduleLabel(log)}</code>
        {rid ? (
          <>
            <span className="font-sans text-fg-muted">{labels.requestId}</span>
            <code className="break-all text-fg">{rid}</code>
          </>
        ) : null}
        {sid ? (
          <>
            <span className="font-sans text-fg-muted">{labels.sessionId}</span>
            <code className="break-all text-fg">{sid}</code>
          </>
        ) : null}
      </div>
      {log.meta && Object.keys(log.meta).length > 0 ? (
        <div>
          <span className="text-xs font-sans font-medium text-fg-muted">{labels.metadata}</span>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border border-edge bg-surface-base p-3 text-xs leading-relaxed text-fg dark:border-edge">
            {JSON.stringify(log.meta, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
