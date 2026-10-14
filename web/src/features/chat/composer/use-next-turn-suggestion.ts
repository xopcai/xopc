import { useCallback, useEffect, useRef, useState } from 'react';
import { nextTurnSuggestionResponseSchema, type NextTurnSuggestion, type NextTurnSuggestionFeedback } from '@xopcai/gateway-contract';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { readLocalSessionDraft, readSessionTranscript } from '@/features/chat/session/local-session-drafts';
import { useGatewayStore } from '@/stores/gateway-store';

type SuggestionSelection = { suggestion: NextTurnSuggestion; impressionId: string };

export function useNextTurnSuggestion(options: {
  conversationId: string | null; agentId?: string; modelKey?: string; locale: 'zh' | 'en'; enabled: boolean;
  draftText: string;
  canShow: boolean;
}) {
  const { conversationId, agentId, modelKey, locale, enabled, draftText, canShow } = options;
  const gatewayIdentity = useGatewayStore(state => state.conversationId);
  const [selection, setSelection] = useState<SuggestionSelection | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const acceptedRef = useRef<SuggestionSelection | null>(null);
  const previousDraftRef = useRef(draftText);
  const revisionRef = useRef(-1);

  const feedback = useCallback((value: SuggestionSelection, event: NextTurnSuggestionFeedback['event'], edited?: boolean) => {
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(value.suggestion.conversationId)}/next-turn-suggestion-feedback`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionId: value.suggestion.id, impressionId: value.impressionId, event, ...(edited === undefined ? {} : { edited }) }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (previousDraftRef.current.length > 0 && draftText.length === 0) acceptedRef.current = null;
    previousDraftRef.current = draftText;
  }, [draftText]);

  useEffect(() => {
    acceptedRef.current = null;
    revisionRef.current = -1;
    setSelection(null);
    setDismissedId(null);
  }, [conversationId, agentId, modelKey, locale, gatewayIdentity]);

  useEffect(() => {
    setSelection(null);
    if (!enabled || !conversationId) return;
    let disposed = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const controller = new AbortController();
    const fetchSuggestion = async () => {
      const current = ++generation;
      try {
        if (await readLocalSessionDraft(conversationId)) return;
        const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(conversationId)}/next-turn-suggestion?locale=${locale}`), { signal: controller.signal });
        if (!response.ok) return;
        const parsed = nextTurnSuggestionResponseSchema.safeParse(await response.json());
        if (disposed || current !== generation || !parsed.success) return;
        const suggestion = parsed.data.suggestion;
        if (parsed.data.status === 'ready' && suggestion && suggestion.conversationId === conversationId
          && suggestion.locale === locale && (!agentId || suggestion.agentId === agentId)
          && suggestion.inputRevision >= revisionRef.current && suggestion.expiresAt > Date.now()
          && suggestion.transcriptId === await readSessionTranscript(conversationId)) {
          if (disposed || current !== generation) return;
          setSelection(previous => previous?.suggestion.id === suggestion.id ? previous : { suggestion, impressionId: crypto.randomUUID() });
          timer = setTimeout(() => { setSelection(null); }, Math.max(0, suggestion.expiresAt - Date.now()));
        } else {
          setSelection(null);
          if (parsed.data.status === 'pending' && attempts++ < 7) timer = setTimeout(() => { void fetchSuggestion(); }, 600);
        }
      } catch { /* Suggestion errors keep the ordinary placeholder. */ }
    };
    const invalidate = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string; key?: string; revision?: number }>).detail;
      if (detail?.conversationId !== conversationId && detail?.key !== conversationId) return;
      if (typeof detail.revision === 'number') {
        if (detail.revision < revisionRef.current) return;
        revisionRef.current = detail.revision;
      }
      generation++;
      attempts = 0;
      if (timer) clearTimeout(timer);
      setSelection(null);
      void fetchSuggestion();
    };
    const reconnect = () => { generation++; attempts = 0; if (timer) clearTimeout(timer); setSelection(null); void fetchSuggestion(); };
    const gap = (event: Event) => { if ((event as CustomEvent<{ topic?: string }>).detail?.topic === 'sessions') reconnect(); };
    void fetchSuggestion();
    const events = ['session-next-turn-suggestion-changed', 'session-input-state', 'session-updated'];
    events.forEach(name => window.addEventListener(name, invalidate));
    window.addEventListener('gateway-realtime-connected', reconnect);
    window.addEventListener('config-reload', reconnect);
    window.addEventListener('realtime-gap', gap);
    return () => {
      disposed = true; generation++; controller.abort();
      if (timer) clearTimeout(timer);
      events.forEach(name => window.removeEventListener(name, invalidate));
      window.removeEventListener('gateway-realtime-connected', reconnect);
      window.removeEventListener('config-reload', reconnect);
      window.removeEventListener('realtime-gap', gap);
    };
  }, [conversationId, agentId, modelKey, locale, gatewayIdentity, enabled]);

  const visible = enabled && canShow && draftText.length === 0 && selection?.suggestion.id !== dismissedId
    && selection?.suggestion.conversationId === conversationId && selection.suggestion.expiresAt > Date.now() ? selection : null;
  const shown = useCallback(() => { if (visible) feedback(visible, 'shown'); }, [visible, feedback]);
  const accept = useCallback(() => {
    if (!visible) return null;
    acceptedRef.current = visible;
    feedback(visible, 'accepted');
    return visible.suggestion.prompt;
  }, [visible, feedback]);
  const dismiss = useCallback(() => {
    if (visible) { setDismissedId(visible.suggestion.id); feedback(visible, 'dismissed'); }
  }, [visible, feedback]);
  const submitted = useCallback((text: string) => {
    const value = acceptedRef.current;
    if (!value || value.suggestion.conversationId !== conversationId) return;
    setDismissedId(value.suggestion.id);
    feedback(value, 'submitted', text.trim() !== value.suggestion.prompt);
    acceptedRef.current = null;
  }, [conversationId, feedback]);
  return { suggestion: visible?.suggestion ?? null, shown, accept, dismiss, submitted };
}
