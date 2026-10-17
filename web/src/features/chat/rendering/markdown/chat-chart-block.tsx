import { ChartSpecError, parseChartSpec, type ChartSpec } from '@xopcai/chart-spec';
import * as Dialog from '@radix-ui/react-dialog';
import { Maximize2, X } from 'lucide-react';
import { memo, useCallback, useId, useMemo, useState } from 'react';

import { ChartCanvas } from '@/components/charts/chart-canvas';
import { Skeleton } from '@/components/ui/skeleton';
import { useInlinePreviewLease } from '@/features/chat/product-delivery/inline-preview-scheduler';
import { messages } from '@/i18n/messages';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useLocaleStore } from '@/stores/locale-store';

import { ChatCodeBlock } from './chat-code-block';

const actionClass = 'min-h-11 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent sm:min-h-9';

function ChartPresentation({ spec, source, copy }: { spec: ChartSpec; source: string; copy: boolean }) {
  const id = useId();
  const lease = useInlinePreviewLease(id);
  const [sourceView, setSourceView] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  const failPreview = useCallback(() => setPreviewFailed(true), []);
  const locale = useLocaleStore(s => s.language);
  const labels = messages(locale).chat.chart;
  const showSource = sourceView || failed;

  return <figure ref={lease.containerRef} className="my-4 min-w-0 overflow-hidden rounded-lg border border-edge bg-surface-panel" data-chart-block="">
    <figcaption className="flex flex-wrap items-center gap-1 border-b border-edge px-3 py-1">
      <span className="min-w-0 basis-full break-words text-sm font-medium text-fg sm:flex-1 sm:basis-0">{spec.title}</span>
      {spec.dataKind === 'example' && <span className="text-xs text-fg-muted">{labels.example}</span>}
      <button type="button" className={actionClass} aria-pressed={showSource} onClick={() => setSourceView(!showSource)} disabled={failed}>{showSource ? labels.chart : labels.source}</button>
      {copy && <button type="button" className={actionClass} onClick={() => {
        void copyTextToClipboard(source).then(ok => { setCopyFailed(!ok); setCopied(ok); });
      }}>{copied ? messages(locale).chat.messageCopied : labels.copy}</button>}
      <button type="button" className={actionClass} aria-label={labels.preview} onClick={() => { setPreviewFailed(false); setExpanded(true); }}><Maximize2 className="size-4" aria-hidden /></button>
    </figcaption>
    {copyFailed && <p role="status" className="px-3 text-xs text-fg-muted">{labels.copyFailed}</p>}
    {failed && <div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted" role="status">{labels.failed}<button type="button" className={actionClass} onClick={() => { lease.activate(); setFailed(false); setSourceView(false); }}>{labels.retry}</button></div>}
    {showSource ? <pre className="max-h-[360px] overflow-auto p-3 text-xs"><code className="language-json">{source}</code></pre>
      : lease.active && !expanded ? <ChartCanvas spec={spec} onError={fail} />
        : <div className="relative h-[280px] p-4 sm:h-[360px]">
          <Skeleton className="h-full w-full" />
          <button type="button" className={`${actionClass} absolute inset-0 m-auto h-10 w-fit bg-surface-panel`} onClick={lease.activate}>{labels.activate}</button>
        </div>}
    <p className="px-3 pb-2 text-xs text-fg-muted">{spec.summary}</p>
    {spec.sources && <p className="px-3 pb-2 text-xs text-fg-muted">{labels.sources}: {spec.sources.join(' · ')}</p>}
    <details className="border-t border-edge px-3 py-2 text-xs text-fg-muted" onToggle={event => setTableOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer">{labels.data}</summary>
      {tableOpen && <div className="max-h-64 overflow-auto"><table>
        <caption>{spec.yAxis.label} ({spec.yAxis.unit})</caption>
        <thead><tr><th scope="col">{spec.xAxis.label}</th>{spec.series.map(series => <th scope="col" key={series.name}>{series.name}</th>)}</tr></thead>
        <tbody>{spec.xAxis.values.map((label, i) => <tr key={i}><th scope="row">{label}</th>{spec.series.map(series => <td key={series.name}>{series.values[i] ?? '—'}</td>)}</tr>)}</tbody>
      </table></div>}
    </details>
    <Dialog.Root open={expanded} onOpenChange={setExpanded}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-scrim/90 backdrop-blur-sm" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[91] flex h-[min(90dvh,52rem)] w-[min(96vw,80rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay outline-none">
          <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{spec.title}</Dialog.Title>
            <Dialog.Close className={actionClass} aria-label={labels.close}><X className="size-4" aria-hidden /></Dialog.Close>
          </div>
          <Dialog.Description className="line-clamp-2 shrink-0 px-3 py-2 text-xs text-fg-muted">{spec.summary}</Dialog.Description>
          <div className="min-h-0 flex-1 overflow-hidden p-2">
            {previewFailed ? <p role="status" className="text-sm text-fg-muted">{labels.failed}</p> : <ChartCanvas spec={spec} expanded onError={failPreview} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </figure>;
}

export const ChatChartBlock = memo(function ChatChartBlock({ source, incomplete, streaming, copy }: {
  source: string; incomplete: boolean; streaming: boolean; copy: boolean;
}) {
  const locale = useLocaleStore(s => s.language);
  const labels = messages(locale).chat.chart;
  const result = useMemo(() => {
    if (incomplete) return null;
    try { return { spec: parseChartSpec(source) }; }
    catch (error) { return { error: error instanceof ChartSpecError ? error : new ChartSpecError('$', 'INVALID_JSON') }; }
  }, [source, incomplete]);
  if (!result) return <div className="my-4 rounded-lg border border-edge p-3" data-chart-pending="">
    {streaming ? <div className="h-[280px] sm:h-[360px]" role="status" aria-label={labels.generating}><Skeleton className="h-full w-full" /></div> : <p role="status" className="text-sm text-fg-muted">{labels.incomplete}</p>}
    <details><summary className="cursor-pointer text-xs text-fg-muted">{labels.source}</summary><pre className="max-h-64 overflow-auto text-xs"><code>{source}</code></pre></details>
  </div>;
  if (result.error) return <div className="my-4 rounded-lg border border-edge p-3" data-chart-error="">
    <p role="status" className="text-sm text-fg-muted">{labels.invalid} ({result.error.path}: {labels.errors[result.error.code as keyof typeof labels.errors] ?? labels.invalid})</p>
    <ChatCodeBlock code={source} language="json" incomplete={false} renderMermaid={false} actions={false} copy={copy} />
  </div>;
  return <ChartPresentation key={source} spec={result.spec} source={source} copy={copy} />;
});
