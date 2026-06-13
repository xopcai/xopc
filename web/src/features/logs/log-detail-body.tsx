import { Button } from '@/components/ui/button';
import type { LogEntry } from '@/features/logs/log.types';
import { extractErrorDetail, levelLabel, moduleLabel, phaseLabel } from '@/features/logs/logs-page-lib';
import type { LogsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

export type LogDetailLabels = Pick<
  LogsMessages,
  | 'time'
  | 'level'
  | 'module'
  | 'message'
  | 'metadata'
  | 'requestId'
  | 'sessionId'
  | 'phase'
  | 'stackTrace'
  | 'filterByRequestId'
  | 'filterBySessionId'
  | 'openChat'
>;

type Props = {
  log: LogEntry;
  labels: LogDetailLabels;
  onFilterByRequestId?: (requestId: string) => void;
  onFilterBySessionId?: (sessionId: string) => void;
  onOpenChat?: (sessionId: string) => void;
};

export function LogDetailBody({
  log,
  labels,
  onFilterByRequestId,
  onFilterBySessionId,
  onOpenChat,
}: Props) {
  const lv = log.level ?? 'info';
  const rid = typeof log.requestId === 'string' ? log.requestId : '';
  const sid = typeof log.sessionId === 'string' ? log.sessionId : '';
  const phase = phaseLabel(log);
  const errDetail = extractErrorDetail(log);
  const isError = lv === 'error' || lv === 'fatal';

  return (
    <div className="flex flex-col gap-8">
      <div>
        <span className="text-xs font-sans font-medium text-fg-muted">{labels.message}</span>
        <pre
          className={cn(
            'mt-2 whitespace-pre-wrap break-words border border-edge bg-surface-base p-3 text-xs leading-relaxed text-fg dark:border-edge',
            isError && 'border-red-500/40',
          )}
        >
          {log.message || '—'}
        </pre>
      </div>

      {errDetail?.stack ? (
        <div>
          <span className="text-xs font-sans font-medium text-fg-muted">{labels.stackTrace}</span>
          {errDetail.name ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errDetail.name}</p>
          ) : null}
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border border-red-500/30 bg-surface-base p-3 text-xs leading-relaxed text-fg dark:border-red-500/30">
            {errDetail.stack}
          </pre>
        </div>
      ) : null}

      <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-xs">
        <span className="font-sans text-fg-muted">{labels.time}</span>
        <code className="break-all text-fg">{log.timestamp}</code>
        <span className="font-sans text-fg-muted">{labels.level}</span>
        <span className={cn('text-fg', isError && 'font-medium text-red-600 dark:text-red-400')}>
          {levelLabel(lv)}
        </span>
        <span className="font-sans text-fg-muted">{labels.module}</span>
        <code className="break-all text-fg">{moduleLabel(log)}</code>
        {phase !== '—' ? (
          <>
            <span className="font-sans text-fg-muted">{labels.phase}</span>
            <code className="break-all text-fg">{phase}</code>
          </>
        ) : null}
        {rid ? (
          <>
            <span className="font-sans text-fg-muted">{labels.requestId}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="break-all text-fg">{rid}</code>
              {onFilterByRequestId ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onFilterByRequestId(rid)}
                >
                  {labels.filterByRequestId}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        {sid ? (
          <>
            <span className="font-sans text-fg-muted">{labels.sessionId}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="break-all text-fg">{sid}</code>
              {onFilterBySessionId ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onFilterBySessionId(sid)}
                >
                  {labels.filterBySessionId}
                </Button>
              ) : null}
              {onOpenChat ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onOpenChat(sid)}
                >
                  {labels.openChat}
                </Button>
              ) : null}
            </div>
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
