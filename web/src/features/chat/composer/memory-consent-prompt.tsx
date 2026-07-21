import { Brain, Check, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type MemoryConsentRequest = {
  id: string;
  recordId: string;
  statement: string;
  purpose: string;
};

type MemoryConsentEvent = CustomEvent<{
  sessionKey?: string;
  requests?: Array<Record<string, unknown>>;
}>;

function normalizeRequests(raw: Array<Record<string, unknown>> | undefined): MemoryConsentRequest[] {
  return (raw ?? []).flatMap((request) => {
    const id = typeof request.id === 'string' ? request.id : '';
    const recordId = typeof request.recordId === 'string' ? request.recordId : '';
    const statement = typeof request.statement === 'string' ? request.statement.trim() : '';
    const purpose = typeof request.purpose === 'string' ? request.purpose.trim() : '';
    return id && recordId && statement ? [{ id, recordId, statement, purpose }] : [];
  });
}

export function MemoryConsentPrompt({ sessionKey, language }: { sessionKey: string; language: 'en' | 'zh' }) {
  const t = messages(language).chat;
  const [requests, setRequests] = useState<MemoryConsentRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = requests[0];

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as MemoryConsentEvent).detail;
      if (detail?.sessionKey !== sessionKey) return;
      const incoming = normalizeRequests(detail.requests);
      if (!incoming.length) return;
      setRequests((current) => {
        const byId = new Map([...current, ...incoming].map((item) => [item.id, item]));
        return [...byId.values()];
      });
      setError(false);
    };
    window.addEventListener('memory-consent-required', onRequest);
    return () => window.removeEventListener('memory-consent-required', onRequest);
  }, [sessionKey]);

  useEffect(() => {
    setRequests([]);
    setError(false);
  }, [sessionKey]);

  const purpose = useMemo(() => request?.purpose.slice(0, 140), [request?.purpose]);
  if (!request) return null;

  const decide = async (decision: 'deny' | 'once' | 'session' | 'always') => {
    setBusy(true);
    setError(false);
    try {
      await fetchJson(apiUrl(`/api/you/consents/${encodeURIComponent(request.id)}`), {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      });
      setRequests((current) => current.filter((item) => item.id !== request.id));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t.memoryConsentAria}
      className="mx-auto mb-2 w-full max-w-[var(--max-width-chat)] rounded-xl border border-accent/25 bg-accent-soft/45 px-3.5 py-3"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-surface-panel text-accent" aria-hidden>
          <Brain className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{t.memoryConsentTitle}</h2>
            {requests.length > 1 ? <span className="text-xs text-fg-subtle">{requests.length}</span> : null}
          </div>
          <p className="mt-1 text-sm leading-5 text-fg">{request.statement}</p>
          {purpose ? <p className="mt-1 text-xs text-fg-muted">{t.memoryConsentPurpose.replace('{{purpose}}', purpose)}</p> : null}
          <p className="mt-1 flex items-center gap-1 text-xs text-fg-subtle"><ShieldCheck className="size-3.5" aria-hidden />{t.memoryConsentHint}</p>
          {error ? <p role="alert" className="mt-2 text-xs text-danger">{t.memoryConsentError}</p> : null}
          <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
            <Button type="button" variant="ghost" className="h-8 px-2.5" disabled={busy} onClick={() => void decide('deny')}>{t.memoryConsentDeny}</Button>
            <Button type="button" variant="secondary" className="h-8 px-2.5" disabled={busy} onClick={() => void decide('once')}>{t.memoryConsentOnce}</Button>
            <Button type="button" variant="secondary" className="h-8 px-2.5" disabled={busy} onClick={() => void decide('session')}>{t.memoryConsentSession}</Button>
            <Button type="button" variant="primary" className="h-8 px-2.5" disabled={busy} onClick={() => void decide('always')}>{t.memoryConsentAlways}</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MemoryCaptureReceipt({ sessionKey, language }: { sessionKey: string; language: 'en' | 'zh' }) {
  const t = messages(language).chat;
  const [record, setRecord] = useState<{ id: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onCaptured = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: string; records?: Array<Record<string, unknown>> }>).detail;
      if (detail?.sessionKey !== sessionKey) return;
      const first = detail.records?.[0];
      const id = typeof first?.id === 'string' ? first.id : '';
      const content = typeof first?.content === 'string' ? first.content : '';
      if (id && content) setRecord({ id, content });
    };
    window.addEventListener('memory-captured', onCaptured);
    return () => window.removeEventListener('memory-captured', onCaptured);
  }, [sessionKey]);

  useEffect(() => {
    if (!record) return;
    const timeout = window.setTimeout(() => setRecord(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [record]);

  useEffect(() => setRecord(null), [sessionKey]);
  if (!record) return null;

  const undo = async () => {
    setBusy(true);
    try {
      await fetchJson(apiUrl(`/api/you/understanding/${encodeURIComponent(record.id)}`), { method: 'DELETE' });
      setRecord(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="mx-auto mb-2 flex w-full max-w-[var(--max-width-chat)] items-center gap-2.5 rounded-xl border border-edge bg-surface-panel px-3.5 py-2.5">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success" aria-hidden><Check className="size-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-fg">{t.memoryCaptured}</p>
        <p className="truncate text-xs text-fg-muted">{record.content} · {t.memoryCapturedHint}</p>
      </div>
      <Button type="button" variant="ghost" className="h-8 shrink-0 px-2.5" disabled={busy} onClick={() => void undo()}>{t.memoryCapturedUndo}</Button>
    </div>
  );
}
