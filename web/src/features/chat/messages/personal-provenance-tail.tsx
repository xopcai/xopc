import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { PersonalProvenanceDetailSchema, type PersonalFeedback, type PersonalProvenance, type PersonalProvenanceDetail } from '@xopcai/gateway-contract';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type Envelope = { ok: boolean; payload?: unknown; error?: string };

export function PersonalProvenanceTail({ provenance }: { provenance: PersonalProvenance }) {
  const language = useLocaleStore(state => state.language);
  const zh = language === 'zh';
  const errors = messages(language).chat.provenanceErrors;
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PersonalProvenanceDetail>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [revision, setRevision] = useState(0);
  const labels = zh ? { follow_up: '跟进你交代的事情', discussion: '延续之前的讨论', change: '关注的事情有新进展', prepared: '之前的准备有了结果' }
    : { follow_up: 'Following up as requested', discussion: 'Continuing our discussion', change: 'An update on what matters', prepared: 'Your preparation is ready' };
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDetail(undefined); setError('');
    void fetchJson<Envelope>(apiUrl(`/api/personal-agent/outreach/${provenance.outreachId}/provenance`)).then(response => {
      if (!response.ok) throw new Error(response.error ?? errors.load);
      if (active) setDetail(PersonalProvenanceDetailSchema.parse(response.payload));
    }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [open, provenance.outreachId, revision, errors.load]);
  async function feedback(kind: PersonalFeedback['kind'], extra: Partial<PersonalFeedback> = {}) {
    setBusy(true); setError('');
    try {
      const response = await fetchJson<Envelope>(apiUrl(`/api/personal-agent/outreach/${provenance.outreachId}/feedback`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), kind, scope: 'thread', ...extra }),
      });
      if (!response.ok) throw new Error(response.error ?? errors.save);
      setAdjust(false); setRevision(value => value + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function undo() {
    const latest = detail?.strategy?.versions[0];
    if (!detail || !latest || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetchJson<Envelope>(apiUrl(`/api/personal-agent/attention/${detail.thread.id}/strategy/rollback`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: latest.id, revision: detail.thread.revision, idempotencyKey: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error(response.error ?? errors.undo);
      setAdjust(false); setRevision(value => value + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const ended = detail && ['completed', 'expired'].includes(detail.thread.status);
  return <Dialog.Root open={open} onOpenChange={value => { setOpen(value); setAdjust(false); }}>
    <Dialog.Trigger asChild><button type="button" className="mt-2 flex max-w-full items-center gap-1.5 rounded text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={zh ? '查看主动联系的缘由' : 'Why this message'}>
      <Sparkles className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="truncate">{labels[provenance.reasonKind]}</span><ChevronRight className="size-3.5 shrink-0" aria-hidden />
    </button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/20" />
      <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[min(28rem,75dvh)] flex-col overflow-hidden rounded-t-2xl border border-edge bg-surface-panel sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(25rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <Dialog.Title className="text-sm font-medium text-fg">{zh ? '为什么联系你' : 'Why I reached out'}</Dialog.Title>
          <Dialog.Close className="rounded p-1 text-fg-muted hover:text-fg" aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Dialog.Close>
        </div>
        <Dialog.Description className="sr-only">{zh ? '消息的依据、时机与后续跟进' : 'Sources, timing, and follow-up for this message'}</Dialog.Description>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {!detail && !error && <><Skeleton className="h-5 w-3/4" /><Skeleton className="h-20 w-full" /><Skeleton className="h-12 w-full" /></>}
          {detail && <>
            <div><p className="mb-1 font-medium text-fg">{zh ? '为什么关注' : 'Why this topic'}</p>
              <p className="text-fg-muted">{detail.sourcesAvailable ? detail.thread.subject : zh ? '原始依据已不可用' : 'The original sources are no longer available'}</p>
              {detail.sourcesAvailable && provenance.authority === 'inferred' && <p className="mt-1 text-xs text-fg-muted">{zh ? '根据之前的讨论判断你可能仍在关注，并非明确委托。' : 'Inferred from our discussion; this is not an explicit request.'}</p>}
            </div>
            {detail.sourcesAvailable && <div><p className="mb-1 font-medium text-fg">{zh ? '为什么现在联系' : 'Why now'}</p><p className="text-fg-muted">{detail.whyNow}</p></div>}
            {detail.sources.map(source => <a key={source.entryId} className="block rounded border border-edge p-2 text-fg-muted hover:text-accent"
              onClick={() => setOpen(false)}
              href={`#/chat/${encodeURIComponent(source.conversationId)}?entryId=${encodeURIComponent(source.entryId)}`}>
              <span className="line-clamp-2 text-xs">{source.excerpt}</span><span className="mt-1 block text-xs text-accent">{zh ? '查看相关对话' : 'View conversation'} ↗</span>
            </a>)}
            <div><p className="mb-1 font-medium text-fg">{zh ? '后续' : 'Next'}</p><p className="text-fg-muted">{ended ? zh ? '已停止关注' : 'No longer following'
              : detail.thread.status === 'paused' ? zh ? '已延后跟进' : 'Follow-up postponed'
                : zh ? '有新的有效进展时，再判断是否值得交流。' : 'I will reassess when there is something useful to share.'}</p></div>
            {adjust && <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className="rounded border border-edge px-3 py-2" onClick={() => void feedback('defer', { until: Date.now() + 7 * 86_400_000 })}>{zh ? '下周再跟进' : 'Next week'}</button>
              <button type="button" disabled={busy} className="rounded border border-edge px-3 py-2" onClick={() => void feedback('adjust', { preparation: 'thorough' })}>{zh ? '以后先准备完整' : 'Prepare more thoroughly'}</button>
              <button type="button" disabled={busy} className="rounded border border-edge px-3 py-2" onClick={() => void feedback('adjust', { preparation: 'brief' })}>{zh ? '以后简短一点' : 'Keep it brief'}</button>
            </div>}
            {detail.strategy && <div className="text-xs text-fg-muted">
              <p>{zh ? '准备方式：' : 'Preparation: '}{detail.strategy.preparation === 'thorough' ? zh ? '先准备完整' : 'Thorough'
                : detail.strategy.preparation === 'brief' ? zh ? '简短交流' : 'Brief' : zh ? '按当前内容判断' : 'Based on the topic'}</p>
              {detail.strategy.versions.length > 0 && <details className="mt-2"><summary className="cursor-pointer">{zh ? '查看调整记录' : 'View adjustments'}</summary>
                <ul className="mt-2 space-y-1">{detail.strategy.versions.map(version => <li key={version.id}>
                  {zh ? { stop: '停止关注', defer: '延后跟进', adjust: '调整准备方式', rollback: '撤销调整' }[version.kind]
                    : { stop: 'Stopped', defer: 'Postponed', adjust: 'Preparation changed', rollback: 'Undone' }[version.kind]}
                  {' · '}{new Date(version.createdAt).toLocaleString(zh ? 'zh-CN' : 'en')}
                </li>)}</ul>
              </details>}
            </div>}
          </>}
          {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
        <div className="flex gap-3 border-t border-edge px-5 py-3 text-xs">
          <button type="button" disabled={!detail || busy || Boolean(ended)} onClick={() => setAdjust(value => !value)} className="text-fg-muted hover:text-fg disabled:opacity-50">{zh ? '调整跟进' : 'Adjust follow-up'}</button>
          <button type="button" disabled={!detail || busy || Boolean(ended)} onClick={() => void feedback('stop')} className="text-fg-muted hover:text-fg disabled:opacity-50">{zh ? '停止关注' : 'Stop following'}</button>
          {detail?.strategy?.versions.length ? <button type="button" disabled={busy || !detail.sourcesAvailable} onClick={() => void undo()} className="ml-auto text-fg-muted hover:text-fg disabled:opacity-50">{zh ? '撤销最近调整' : 'Undo latest'}</button> : null}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
