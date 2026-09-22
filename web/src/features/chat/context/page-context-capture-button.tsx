import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileText, Loader2 } from 'lucide-react';
import type { AppContextEnvelope } from '@xopcai/gateway-contract';

import { messages } from '@/i18n/messages';
import { readCapability } from '@/lib/capabilities';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { SessionManager } from '../session/session-manager';
import { pageContextDraftKey, pageContextDrafts } from './page-context-draft';

/** Explicit resource capture only; never crawls page DOM, iframes, or related resources. */
export function PageContextCaptureButton({ resource, selection, label, disabled = false }: {
  resource: AppContextEnvelope['resourceRefs'][number]; selection?: AppContextEnvelope['selection']; label?: string; disabled?: boolean;
}) {
  const language = useLocaleStore(state => state.language);
  const labels = messages(language).chat.pageContext;
  const navigate = useNavigate();
  const location = useLocation();
  const locationKey = location.key;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const gatewayUrl = useGatewayStore(state => state.baseUrl);
  const namespace = useGatewayStore(state => state.conversationId);
  useEffect(() => {
    pending.current = false;
    setBusy(false);
    setFailed(false);
    return () => { generation.current += 1; };
  }, [locationKey, resource.kind, resource.id, resource.revision, selection?.text, selection?.draft, disabled, gatewayUrl, namespace]);

  async function capture() {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    const current = generation.current;
    const isCurrent = () => generation.current === current
      && useGatewayStore.getState().baseUrl === gatewayUrl
      && useGatewayStore.getState().conversationId === namespace;
    try {
      const draft = pageContextDrafts.capture({ title: '', text: '', resourceRefs: [resource], selection });
      const resolved = await readCapability('xopc.context.resolve', draft.envelope);
      if (!isCurrent()) return;
      const result = resolved.resources[0];
      if (resolved.resources.length !== 1 || JSON.stringify(resolved.snapshot) !== JSON.stringify(draft.envelope)
        || result.reference.kind !== resource.kind || result.reference.id !== resource.id
        || result.reference.revision !== resource.revision) throw new Error('Context mismatch');
      draft.title = result.title;
      draft.preview = result.text;
      draft.truncated = result.truncated;
      const session = await new SessionManager().createSession();
      if (!isCurrent()) return;
      if (!pageContextDrafts.put(pageContextDraftKey(gatewayUrl, namespace, session.key), draft)) {
        throw new Error('Context draft limit reached');
      }
      navigate(`/chat/${encodeURIComponent(session.key)}`);
    } catch {
      if (isCurrent()) setFailed(true);
    } finally {
      if (generation.current === current) { pending.current = false; setBusy(false); }
    }
  }
  return <div className="flex min-w-0 flex-col items-start gap-1">
    <button type="button" disabled={disabled || busy} onClick={() => void capture()} aria-busy={busy}
      title={disabled ? labels.unavailable : label ?? labels.capture}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
      {label ?? labels.capture}
    </button>
    {failed ? <p role="alert" className="max-w-72 text-xs text-danger">{labels.unavailable}</p> : null}
  </div>;
}
