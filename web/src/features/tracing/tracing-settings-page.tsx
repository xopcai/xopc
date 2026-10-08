import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { AutosaveStatus } from '@/components/ui/autosave-status';
import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { useAutosave } from '@/lib/use-autosave';
import { useLocaleStore } from '@/stores/locale-store';
import { traceRequest, traceUrl, type TraceDetail, type TraceRecord, type TraceSettings, type TraceStatus, type TracingConfig } from './tracing-api';

const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg';
const panelClass = 'space-y-4 rounded-xl border border-edge bg-surface-panel p-4';
const size = (bytes = 0) => `${(bytes / 1048576).toFixed(1)} MiB`;
function TracingSkeleton() { return <div aria-busy="true" className="space-y-4"><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>; }
function spanDepth(span: TraceRecord, spans: TraceRecord[]) {
  let depth = 0; let current = span; const seen = new Set<string>();
  while (current.parentSpanId && depth < 12 && !seen.has(current.spanId)) {
    seen.add(current.spanId); const parent = spans.find(item => item.spanId === current.parentSpanId);
    if (!parent) break; current = parent; depth++;
  }
  return depth;
}
function orderedSpans(spans: TraceRecord[]) {
  const result: TraceRecord[] = []; const visited = new Set<string>();
  function visit(span: TraceRecord) { if (visited.has(span.spanId)) return; visited.add(span.spanId); result.push(span); spans.filter(item => item.parentSpanId === span.spanId).forEach(visit); }
  spans.filter(span => !span.parentSpanId || !spans.some(item => item.spanId === span.parentSpanId)).forEach(visit);
  spans.forEach(visit); return result;
}
export function TracingSettingsPage() {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const t = (en: string, cn: string) => zh ? cn : en;
  const settings = useSWR<TraceSettings>(traceUrl('tracing/settings'), () => traceRequest<TraceSettings>('tracing/settings'));
  const status = useSWR<TraceStatus>(traceUrl('tracing/status'), () => traceRequest('tracing/status'), { refreshInterval: 10000 });
  const [draft, setDraft] = useState<TracingConfig>();
  const [savedConfig, setSavedConfig] = useState<TracingConfig>();
  const cfg = draft ?? savedConfig ?? settings.data?.config;
  const [publicKey, setPublicKey] = useState(''); const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState(''); const [days, setDays] = useState('7');
  const [identity, setIdentity] = useState({ conversationId: '', runId: '', agentId: '' });
  const [view, setView] = useState<'records' | 'settings'>('records');
  const [pageSize, setPageSize] = useState('10');
  const [pageCursors, setPageCursors] = useState<string[]>(['']);
  const [pageIndex, setPageIndex] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(() => Date.now() + 1);
  const cursor = pageCursors[pageIndex];
  const [selected, setSelected] = useState<string>();
  function resetPages() {
    setPageCursors(['']);
    setPageIndex(0);
    setRangeEnd(Date.now() + 1);
  }
  const [confirmClear, setConfirmClear] = useState(false);
  const query = new URLSearchParams({ limit: pageSize, from: String(rangeEnd - Number(days) * 86400000), to: String(rangeEnd) });
  if (filter) query.set('status', filter); if (cursor) query.set('cursor', cursor);
  for (const [key, value] of Object.entries(identity)) if (value) query.set(key, value);
  const path = `traces?${query}`;
  const list = useSWR<{ traces: TraceRecord[]; nextCursor: string | null }>(traceUrl(path), () => traceRequest(path), { refreshInterval: cursor ? 0 : 10000 });
  const detail = useSWR<TraceDetail>(selected ? traceUrl(`traces/${selected}`) : null, () => traceRequest<TraceDetail>(`traces/${selected}`));
  function edit(change: (config: TracingConfig) => void) { if (!cfg) return; const next = structuredClone(cfg); change(next); setDraft(next); }
  async function action(fn: () => Promise<void>, success = t('Saved', '已保存')) {
    setBusy(true); setNotice(''); setFailed(false);
    try { await fn(); setNotice(success); await Promise.all([settings.mutate(), status.mutate(), list.mutate()]); }
    catch (error) { setFailed(true); setNotice(error instanceof Error ? error.message : t('Request failed', '操作失败')); }
    finally { setBusy(false); }
  }
  const configAutosave = useAutosave({
    value: cfg ?? null,
    dirty: Boolean(draft && JSON.stringify(draft) !== JSON.stringify(savedConfig ?? settings.data?.config)),
    validate: snapshot => {
      const limits: [keyof TracingConfig['local'], number, number][] = [
        ['retentionDays', 1, 90], ['maxStoreMiB', 16, 4096], ['maxTraces', 10, 100000],
        ['maxSpans', 100, 1000000], ['maxTraceKiB', 16, 4096], ['maxWriteMiBPerMinute', 1, 100],
      ];
      if (limits.some(([key, min, max]) => !Number.isInteger(snapshot.local[key]) || snapshot.local[key] < min || snapshot.local[key] > max)) return t('Enter valid storage limits before continuing.', '请填写有效的存储限额。');
      try {
        const url = new URL(snapshot.langfuse.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || snapshot.langfuse.baseUrl.length > 2048) throw new Error();
      } catch { return t('Enter a valid HTTP(S) Base URL.', '请填写有效的 HTTP(S) Base URL。'); }
      return null;
    },
    onSave: async snapshot => {
      const saved = await traceRequest<{ config: TracingConfig }>('tracing/settings', 'PATCH', snapshot);
      setSavedConfig(saved.config);
      // A response for an earlier edit must not overwrite a newer local edit.
      setDraft(current => current && JSON.stringify(current) === JSON.stringify(snapshot) ? undefined : current);
      await status.mutate().catch(() => {});
    },
  });
  const credentials = useMemo(() => ({ publicKey: publicKey.trim(), secretKey: secretKey.trim() }), [publicKey, secretKey]);
  const credentialAutosave = useAutosave({
    value: credentials,
    dirty: Boolean(credentials.publicKey || credentials.secretKey),
    delayMs: 1000,
    validate: snapshot => snapshot.publicKey.length > 512 || snapshot.secretKey.length > 512 ? t('Credentials must be at most 512 characters.', '凭证长度不能超过 512 个字符。') : null,
    onSave: async snapshot => {
      await traceRequest('tracing/langfuse/credentials', 'PUT', { ...(snapshot.publicKey ? { publicKey: snapshot.publicKey } : {}), ...(snapshot.secretKey ? { secretKey: snapshot.secretKey } : {}) });
      setPublicKey(current => current.trim() === snapshot.publicKey ? '' : current);
      setSecretKey(current => current.trim() === snapshot.secretKey ? '' : current);
      await Promise.allSettled([settings.mutate(), status.mutate()]);
    },
  });
  const saving = [configAutosave.status, credentialAutosave.status].some(value => value === 'dirty' || value === 'saving');
  async function download() {
    if (!selected) return;
    await action(async () => {
      const data = await traceRequest<TraceDetail>(`traces/${selected}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `trace-${selected}.json`; a.click(); URL.revokeObjectURL(url);
    }, t('Exported', '已导出'));
  }
  return <SettingsPageFrame className="space-y-6">
    <SettingsPageHeader title={t('Runtime tracing', '运行追踪')} subtitle={t('Local diagnostics with bounded retention. Enable Langfuse to also export new traces.', '默认保留有界本地记录；启用 Langfuse 后同时导出新采集的追踪。')} actions={view === 'settings' ? <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-fg-muted">{t('Changes save automatically', '修改后自动保存')}</span><AutosaveStatus status={configAutosave.status} error={configAutosave.error} /></div> : <Button disabled={list.isValidating} onClick={resetPages}>{t('Refresh records', '刷新记录')}</Button>} />
    {notice && <p role={failed ? 'alert' : 'status'} className="text-sm text-fg-muted">{notice}</p>}
    {settings.error && <p role="alert">{String(settings.error.message)}</p>}
    <nav aria-label={t('Tracing sections', '追踪页面分区')} className="flex gap-2 border-b border-edge pb-3">
      <Button aria-pressed={view === 'records'} variant={view === 'records' ? 'primary' : 'ghost'} onClick={() => setView('records')}>{t('Execution records', '执行记录')}</Button>
      <Button aria-pressed={view === 'settings'} variant={view === 'settings' ? 'primary' : 'ghost'} onClick={() => setView('settings')}>{t('Capture settings', '采集设置')}</Button>
    </nav>
    {view === 'settings' && (!cfg ? <TracingSkeleton /> : <>
      <section className={panelClass} onBlurCapture={configAutosave.onBlurCapture}>
        <h2 className="font-medium">{t('Local recording', '本地记录')}</h2>
        {configAutosave.error && <Button variant="ghost" onClick={configAutosave.retry}>{t('Retry autosave', '重试自动保存')}</Button>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.enabled} onChange={e => edit(c => { c.enabled = e.target.checked; })} />{t('Record traces', '记录运行追踪')}</label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1 text-sm">{t('Retention (days)', '保留天数')}<input className={inputClass} type="number" min={1} max={90} value={cfg.local.retentionDays} onChange={e => edit(c => { c.local.retentionDays = Number(e.target.value); })} /></label>
          <label className="space-y-1 text-sm">{t('Storage budget (MiB)', '存储上限（MiB）')}<input className={inputClass} type="number" min={16} max={4096} value={cfg.local.maxStoreMiB} onChange={e => edit(c => { c.local.maxStoreMiB = Number(e.target.value); })} /></label>
          <label className="space-y-1 text-sm">{t('Capture', '采集内容')}<PopoverSelect placeholder={t('Choose', '请选择')} allowEmpty={false} value={cfg.capture} onChange={v => edit(c => { c.capture = v as TracingConfig['capture']; })} options={[{ value: 'metadata', label: t('Metadata only', '仅元数据') }, { value: 'redacted', label: t('Redacted previews', '脱敏摘要') }, { value: 'detailed', label: t('Detailed · 30 minutes', '详细记录 · 30 分钟') }]} /></label>
        </div>
        <p className="text-sm text-fg-muted">{t('Previews may contain personal content. Secrets and media are filtered; large values are truncated.', '摘要可能包含个人内容。过滤凭证和媒体，超长内容会截断。')}</p>
        {cfg.detailedUntil && <p className="text-sm text-fg-muted">{t('Detailed capture expires: ', '详细采集截止：')}{new Date(cfg.detailedUntil).toLocaleString()}</p>}
        <details><summary className="cursor-pointer text-sm">{t('Advanced limits', '高级限制')}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{([
          ['maxTraces', t('Trace count', 'Trace 条数')], ['maxSpans', t('Span count', 'Span 条数')], ['maxTraceKiB', t('Per trace (KiB)', '单 Trace 上限（KiB）')], ['maxWriteMiBPerMinute', t('Write budget (MiB/minute)', '写入额度（MiB/分钟）')],
        ] as const).map(([key, label]) => <label key={key} className="space-y-1 text-sm">{label}<input type="number" min={1} className={inputClass} value={cfg.local[key]} onChange={e => edit(c => { c.local[key] = Number(e.target.value); })} /></label>)}</div></details>
        {!status.data ? <Skeleton className="h-10" /> : <p className="text-sm text-fg-muted">{t('Disk / payload', '磁盘 / 数据')}：{size(status.data.local.physicalBytes)} / {size(status.data.local.bytes)} · {status.data.local.traces ?? 0} traces · {status.data.local.spans ?? 0} spans · {t('Dropped', '丢弃')} {Number(status.data.local.dropped ?? 0) + Number(status.data.local.queueDropped ?? 0)}{(status.data.local.paused || status.data.local.unavailable) && ` · ${t('Recording paused', '存储暂停')}`}</p>}
        {(status.error || status.data?.local.lastError) && <p role="alert" className="text-sm">{status.data?.local.lastError || String(status.error.message)}</p>}
        <div className="flex gap-2"><Button disabled={busy || saving} onClick={() => void action(async () => { await traceRequest('traces/prune', 'POST'); })}>{t('Clean expired', '清理过期记录')}</Button><Button disabled={busy} onClick={() => setConfirmClear(true)}>{t('Clear local traces', '清空本地追踪')}</Button></div>
      </section>
      <section className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Langfuse</h2><AutosaveStatus status={credentialAutosave.status} error={credentialAutosave.error} /></div>
        {credentialAutosave.error && <Button variant="ghost" onClick={credentialAutosave.retry}>{t('Retry autosave', '重试自动保存')}</Button>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.langfuse.enabled} onBlur={configAutosave.onBlurCapture} onChange={e => edit(c => { c.langfuse.enabled = e.target.checked; })} />{t('Also export new traces to Langfuse', '同时导出新采集的追踪到 Langfuse')}</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">Base URL<input className={inputClass} type="url" value={cfg.langfuse.baseUrl} onBlur={configAutosave.onBlurCapture} onChange={e => edit(c => { c.langfuse.baseUrl = e.target.value; })} /></label>
          <label className="space-y-1 text-sm">Public Key<input autoComplete="off" className={inputClass} value={publicKey} onBlur={credentialAutosave.onBlurCapture} placeholder={settings.data?.credentials.publicKeyConfigured ? t('Configured · leave blank to keep', '已配置 · 留空保留') : 'pk-lf-…'} onChange={e => setPublicKey(e.target.value)} /></label>
          <label className="space-y-1 text-sm">Secret Key<input autoComplete="new-password" type="password" className={inputClass} value={secretKey} onBlur={credentialAutosave.onBlurCapture} placeholder={settings.data?.credentials.secretKeyConfigured ? t('Configured · leave blank to keep', '已配置 · 留空保留') : 'sk-lf-…'} onChange={e => setSecretKey(e.target.value)} /></label>
        </div>
        <p className="text-sm text-fg-muted">{t('Credential sources', '凭证来源')}：{settings.data?.credentials.publicKeySource} / {settings.data?.credentials.secretKeySource} · URL: {settings.data?.credentials.baseUrlSource}</p>
        {status.data && <p className="text-sm text-fg-muted">{status.data.langfuse.state} · {t('Pending', '待发送')} {status.data.langfuse.pending} · {t('Dropped', '丢弃')} {status.data.langfuse.dropped}{status.data.langfuse.lastSuccess ? ` · ${new Date(status.data.langfuse.lastSuccess).toLocaleString()}` : ''}</p>}
        {status.data?.langfuse.lastError && <p role="alert" className="text-sm">{status.data.langfuse.lastError}</p>}
        <p className="text-sm text-fg-muted">{t('Changes save automatically. Historical traces are not uploaded. Offline exports may be dropped.', '修改后自动保存。不会上传历史记录；断网或队列满时可能丢弃远端导出。')}</p>
        <div className="flex gap-2"><Button disabled={busy || saving} onClick={() => void action(async () => { const r = await traceRequest<{ ok: boolean }>('tracing/langfuse/test', 'POST'); if (!r.ok) throw new Error(t('Connection test failed. Check saved configuration and credentials.', '连接测试失败，请检查已保存的配置和凭证。')); }, t('Diagnostic trace accepted by the ingestion endpoint', '采集端已接受诊断追踪'))}>{t('Test connection', '测试连接')}</Button><Button disabled={busy || saving} onClick={() => void action(async () => { await traceRequest('tracing/langfuse/credentials', 'DELETE'); setPublicKey(''); setSecretKey(''); })}>{t('Remove saved credentials', '移除已保存凭证')}</Button></div>
      </section>
    </>)}
    {view === 'records' && <section className={panelClass}>
      <h2 className="font-medium">{t('Recent runs', '最近执行')}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">{t('Status', '执行状态')}<PopoverSelect placeholder={t('All statuses', '全部状态')} value={filter} onChange={v => { setFilter(v); resetPages(); }} options={[{ value: '', label: t('All statuses', '全部状态') }, ...['running', 'success', 'error', 'cancelled', 'suspended', 'interrupted'].map(value => ({ value, label: t(value, ({ running: '运行中', success: '成功', error: '失败', cancelled: '已取消', suspended: '已暂停', interrupted: '已中断' } as Record<string, string>)[value]) }))]} /></label>
        <label className="space-y-1 text-sm">{t('Time range', '时间范围')}<PopoverSelect placeholder={t('Choose', '请选择')} value={days} allowEmpty={false} onChange={v => { setDays(v); resetPages(); }} options={['1', '7', '30', '90'].map(value => ({ value, label: `${value} ${t('days', '天')}` }))} /></label>
        <label className="space-y-1 text-sm">{t('Page size', '每页条数')}<PopoverSelect placeholder={t('Choose', '请选择')} value={pageSize} allowEmpty={false} onChange={v => { setPageSize(v); resetPages(); }} options={['10', '20'].map(value => ({ value, label: `${value} ${t('records', '条')}` }))} /></label>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-fg-muted">{t('Advanced filters', '高级筛选')}{Object.values(identity).some(Boolean) ? ` · ${t('Active', '已启用')}` : ''}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(['conversationId', 'runId', 'agentId'] as const).map(key => <label key={key} className="space-y-1 text-sm">{({ conversationId: t('Conversation ID', '会话 ID'), runId: t('Run ID', '执行 ID'), agentId: t('Agent ID', 'Agent ID') })[key]}<input aria-label={key} placeholder={t('Exact ID', '输入完整 ID')} className={inputClass} value={identity[key]} onChange={e => { setIdentity({ ...identity, [key]: e.target.value }); resetPages(); }} /></label>)}
        </div>
      </details>
      <div role="region" aria-label={t('Execution results', '执行结果')} aria-busy={list.isValidating} className="h-[24rem] min-h-0 overflow-y-auto overscroll-contain rounded-lg border border-edge sm:h-[28rem]">
        {list.error && <p role="alert" className="p-4 text-sm">{list.error.message}</p>}
        {!list.data && !list.error ? <div className="space-y-3 p-3">{[0, 1, 2, 3, 4].map(item => <Skeleton key={item} className="h-16" />)}</div> : <div className="divide-y divide-edge">
          {list.data?.traces.length === 0 && <p className="flex h-48 items-center justify-center px-4 text-sm text-fg-muted">{t('No traces in this range', '此时间范围内暂无记录')}</p>}
          {list.data?.traces.map(row => <button key={row.traceId} onClick={() => setSelected(row.traceId)} className="flex w-full flex-col gap-2 px-3 py-3 text-left text-sm hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="truncate font-medium">{row.name}{row.attributes['xopc.agentId'] ? ` · ${row.attributes['xopc.agentId']}` : ''}</p><p className="truncate text-xs text-fg-muted">{new Date(row.startedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')} · {row.traceId}</p>{row.stats && <p className="text-xs text-fg-muted">{row.stats.generations} {t('model calls', '次模型调用')} · {row.stats.tokens} tokens · ${row.stats.knownCostUsd.toFixed(4)}{row.stats.unknownCostCalls > 0 ? ` · ${t('partial cost', '部分成本未知')}` : ''}</p>}</div>
            <span className="shrink-0 text-xs text-fg-muted">{t(row.status, ({ running: '运行中', success: '成功', error: '失败', cancelled: '已取消', suspended: '已暂停', interrupted: '已中断' } as Record<string, string>)[row.status] ?? row.status)} · {row.endedAt ? `${Math.round(row.endedAt - row.startedAt)} ms` : '—'}{row.partialReason ? ` · ${t('Partial', '部分记录')}` : ''}</span>
          </button>)}
        </div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-fg-muted">{t(`Page ${pageIndex + 1} · ${list.data?.traces.length ?? 0} records`, `第 ${pageIndex + 1} 页 · ${list.data?.traces.length ?? 0} 条`)}</p>
        <div className="flex gap-2">
          <Button disabled={pageIndex === 0 || list.isValidating} onClick={() => setPageIndex(index => Math.max(0, index - 1))}>{t('Previous page', '上一页')}</Button>
          <Button disabled={!list.data?.nextCursor || list.isValidating} onClick={() => {
            const next = list.data?.nextCursor;
            if (!next) return;
            setPageCursors(previous => [...previous.slice(0, pageIndex + 1), next]);
            setPageIndex(index => index + 1);
          }}>{t('Next page', '下一页')}</Button>
        </div>
      </div>
    </section>}
    <Dialog.Root open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(undefined); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[91] flex h-[min(44rem,calc(100vh-2rem))] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay p-4">
      <div className="flex shrink-0 items-center justify-between gap-3"><Dialog.Title className="font-medium">{t('Trace details', '追踪详情')}</Dialog.Title><Dialog.Close asChild><Button>{t('Close', '关闭')}</Button></Dialog.Close></div><Dialog.Description className="shrink-0 truncate text-xs text-fg-muted">{selected}</Dialog.Description>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">{detail.error ? <p role="alert">{detail.error.message}</p> : !detail.data ? <TracingSkeleton /> : <>
        <p className="text-sm">{detail.data.trace.status} {detail.data.trace.partialReason && ` · ${detail.data.trace.partialReason}`}</p>
        {orderedSpans(detail.data.spans).map(span => <details key={span.spanId} style={{ marginLeft: spanDepth(span, detail.data!.spans) * 12 }} className="rounded-lg border border-edge p-3 text-sm"><summary className="cursor-pointer">{span.name} · {span.status} · {span.endedAt ? `${Math.round(span.endedAt - span.startedAt)} ms` : '—'}</summary><pre className="mt-3 whitespace-pre-wrap break-all text-xs text-fg-muted">{JSON.stringify(span.attributes, null, 2)}</pre></details>)}
      </>}</div><div className="shrink-0 border-t border-edge pt-3"><Button disabled={!detail.data || busy} onClick={() => void download()}>{t('Export JSON', '导出 JSON')}</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={confirmClear} onOpenChange={setConfirmClear}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-edge bg-surface-overlay p-5"><Dialog.Title>{t('Clear local traces?', '清空本地追踪？')}</Dialog.Title><Dialog.Description className="text-sm text-fg-muted">{t('Removes retained local traces. Conversations, usage records and Langfuse data remain available.', '删除已保留的本地追踪。会话、用量记录及 Langfuse 数据仍保留。')}</Dialog.Description><div className="flex gap-2"><Button disabled={busy || saving} onClick={() => void action(async () => { await traceRequest('traces', 'DELETE'); setConfirmClear(false); setSelected(undefined); })}>{t('Clear', '清空')}</Button><Dialog.Close asChild><Button>{t('Cancel', '取消')}</Button></Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </SettingsPageFrame>;
}
