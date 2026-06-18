import QRCode from 'qrcode';
import { CheckCircle2, ExternalLink, Loader2, QrCode, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SchemaForm, type JsonSchema } from '@/components/ui/schema-form';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { ChannelActionDescriptor, ChannelCatalogEntry } from './use-channel-catalog';

type ActionPayload =
  | { type?: 'ok'; message?: string; configChanged?: boolean; [key: string]: unknown }
  | {
      type: 'qr';
      sessionKey: string;
      qrcodeUrl?: string;
      qrPayload?: string;
      statusAction?: string;
      pollIntervalMs?: number;
      expiresInSec?: number;
      message?: string;
      [key: string]: unknown;
    }
  | {
      type: 'poll';
      phase: 'pending' | 'done' | 'unknown';
      ok?: boolean;
      message?: string;
      accountId?: string;
      qrcodeUrl?: string;
      qrPayload?: string;
      qrStatus?: string;
      configChanged?: boolean;
      [key: string]: unknown;
    }
  | { type: 'diagnostics'; checks: Array<{ id?: string; label?: string; status?: string; message?: string }> }
  | {
      type: 'form';
      schema: JsonSchema;
      values?: Record<string, unknown>;
      submitAction: string;
      message?: string;
    };

type ActionState = {
  payload: ActionPayload | null;
  poll: { actionId: string; sessionKey: string; intervalMs: number } | null;
  busy: boolean;
  error: string | null;
  formDraft: Record<string, unknown>;
  generatedQr: string | null;
};

function choosePrimaryAction(entry: ChannelCatalogEntry): [string, ChannelActionDescriptor] | null {
  const actions = entry.actions ?? {};
  const preferred = ['login.start', 'setup.start'];
  for (const id of preferred) {
    const action = actions[id];
    if (action) return [id, action];
  }
  const first = Object.entries(actions).find(([, action]) => action.result === 'qr' || action.result === 'form');
  return first ?? null;
}

async function runChannelAction(params: {
  channelId: string;
  actionId: string;
  accountId?: string;
  input?: unknown;
}): Promise<ActionPayload> {
  const res = await apiFetch(apiUrl(`/api/channels/${encodeURIComponent(params.channelId)}/actions/${encodeURIComponent(params.actionId)}`), {
    method: 'POST',
    body: JSON.stringify({
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.input !== undefined ? { input: params.input } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    payload?: ActionPayload;
    error?: { message?: string };
  };
  if (!res.ok || body.ok === false) {
    throw new Error(body.error?.message ?? res.statusText);
  }
  return body.payload ?? { type: 'ok' };
}

function isTerminalPoll(payload: ActionPayload | null): boolean {
  return payload?.type === 'poll' && payload.phase === 'done';
}

function payloadMessage(payload: ActionPayload | null): string | null {
  if (!payload) return null;
  if ('message' in payload && typeof payload.message === 'string') return payload.message;
  return null;
}

function payloadQrContent(payload: ActionPayload | null, channelId: string): string | null {
  if (payload?.type !== 'qr' && payload?.type !== 'poll') return null;
  if (payload.qrPayload) return payload.qrPayload;
  // Weixin returns a scan URL, not an image URL; render it as a QR locally.
  if (channelId === 'weixin' && payload.qrcodeUrl) return payload.qrcodeUrl;
  return null;
}

function payloadQrImage(payload: ActionPayload | null): string | null {
  if (payload?.type !== 'qr' && payload?.type !== 'poll') return null;
  return payload.qrcodeUrl ?? null;
}

export function ChannelSetupCard({
  entry,
  onChanged,
}: {
  entry: ChannelCatalogEntry;
  onChanged: () => Promise<void> | void;
}) {
  const primary = useMemo(() => choosePrimaryAction(entry), [entry]);
  const [state, setState] = useState<ActionState>({
    payload: null,
    poll: null,
    busy: false,
    error: null,
    formDraft: {},
    generatedQr: null,
  });

  useEffect(() => {
    setState({
      payload: null,
      poll: null,
      busy: false,
      error: null,
      formDraft: {},
      generatedQr: null,
    });
  }, [entry.id]);

  const runAction = useCallback(async (actionId: string, input?: unknown) => {
    setState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      const payload = await runChannelAction({ channelId: entry.id, actionId, input });
      setState((prev) => ({
        ...prev,
        payload,
        poll:
          payload.type === 'qr' && payload.statusAction && payload.sessionKey
            ? {
                actionId: payload.statusAction,
                sessionKey: payload.sessionKey,
                intervalMs: Math.max(1000, payload.pollIntervalMs ?? 2500),
              }
            : null,
        busy: false,
        formDraft: payload.type === 'form' ? payload.values ?? {} : prev.formDraft,
      }));
      if ('configChanged' in payload && payload.configChanged === true) {
        await onChanged();
      }
    } catch (err) {
      setState((prev) => ({ ...prev, busy: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, [entry.id, onChanged]);

  useEffect(() => {
    const content = payloadQrContent(state.payload, entry.id);
    if (!content) {
      setState((prev) => (prev.generatedQr ? { ...prev, generatedQr: null } : prev));
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.generatedQr ? { ...prev, generatedQr: null } : prev));
    void QRCode.toDataURL(content, { width: 220, margin: 1 }).then((url) => {
      if (!cancelled) setState((prev) => ({ ...prev, generatedQr: url }));
    });
    return () => {
      cancelled = true;
    };
  }, [entry.id, state.payload]);

  useEffect(() => {
    const poll = state.poll;
    if (!poll) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      void runChannelAction({
        channelId: entry.id,
        actionId: poll.actionId,
        input: { sessionKey: poll.sessionKey },
      })
        .then(async (next) => {
          if (cancelled) return;
          setState((prev) => ({
            ...prev,
            payload: next,
            poll: isTerminalPoll(next) ? null : prev.poll,
            error: null,
          }));
          if ('configChanged' in next && next.configChanged === true) {
            await onChanged();
          }
          if (isTerminalPoll(next)) {
            window.clearInterval(timer);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setState((prev) => ({ ...prev, error: err instanceof Error ? err.message : String(err) }));
          }
        });
    }, poll.intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [entry.id, onChanged, state.poll]);

  const primaryLabel = primary?.[1].label ?? (entry.configured ? 'Reconnect' : 'Connect');
  const message = payloadMessage(state.payload);
  const qrContent = payloadQrContent(state.payload, entry.id);
  const qrImage = qrContent ? state.generatedQr : payloadQrImage(state.payload);
  const formPayload = state.payload?.type === 'form' ? state.payload : null;
  const diagnostics = state.payload?.type === 'diagnostics' ? state.payload.checks : null;

  return (
    <div className="rounded-lg border border-edge-subtle bg-surface-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Setup</h3>
          <p className="mt-1 text-sm text-fg-muted">
            {entry.configured ? 'Channel config exists. Use actions below to reconnect or verify it.' : 'Use the fastest setup path for this channel.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {primary ? (
            <Button
              type="button"
              variant="primary"
              disabled={state.busy}
              onClick={() => void runAction(primary[0])}
            >
              {state.busy ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
              {primaryLabel}
            </Button>
          ) : null}
          {entry.actions?.['doctor.run'] ? (
            <Button
              type="button"
              variant="secondary"
              disabled={state.busy}
              onClick={() => void runAction('doctor.run')}
            >
              <Stethoscope className="size-4" />
              Diagnose
            </Button>
          ) : null}
        </div>
      </div>

      {message ? <p className="mt-3 text-sm text-fg-muted">{message}</p> : null}
      {state.error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}

      {qrImage ? (
        <div className="mt-4 flex flex-wrap items-start gap-4">
          <div className="rounded-lg border border-edge bg-white p-3">
            <img src={qrImage} alt={`${entry.label} setup QR`} className="h-52 w-52 object-contain" />
          </div>
          <div className="max-w-sm text-sm text-fg-muted">
            <p>Waiting for confirmation...</p>
            {qrContent ? (
              <a
                className="mt-2 inline-flex items-center gap-1 text-accent hover:underline"
                href={qrContent}
                target="_blank"
                rel="noreferrer"
              >
                Open setup link
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.payload?.type === 'poll' && state.payload.phase === 'done' ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 text-sm">
          <CheckCircle2 className={state.payload.ok ? 'size-4 text-green-600' : 'size-4 text-red-600'} />
          <span className={state.payload.ok ? 'text-fg' : 'text-red-600 dark:text-red-400'}>
            {state.payload.message ?? (state.payload.ok ? 'Complete' : 'Failed')}
          </span>
        </div>
      ) : null}

      {formPayload ? (
        <div className="mt-4 space-y-3">
          <SchemaForm
            schema={formPayload.schema}
            values={state.formDraft}
            onChange={(next) => setState((prev) => ({ ...prev, formDraft: next }))}
            disabled={state.busy}
          />
          <Button
            type="button"
            variant="primary"
            disabled={state.busy}
            onClick={() => void runAction(formPayload.submitAction, state.formDraft)}
          >
            Save setup
          </Button>
        </div>
      ) : null}

      {diagnostics ? (
        <div className="mt-4 space-y-2">
          {diagnostics.map((check, index) => (
            <div key={check.id ?? index} className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-fg">{check.label ?? check.id ?? `Check ${index + 1}`}</p>
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
                  {check.status ?? 'unknown'}
                </span>
              </div>
              {check.message ? <p className="mt-1 text-sm text-fg-muted">{check.message}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
