import QRCode from 'qrcode';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, QrCode, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SchemaForm, type JsonSchema } from '@/components/ui/schema-form';
import { Skeleton } from '@/components/ui/skeleton';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';

import { SelectField } from './select-field';
import { choosePrimaryChannelAction } from './channel-primary-action';
import type { ChannelCatalogEntry } from './use-channel-catalog';

export type ChannelActionPayload =
  | { type?: 'ok'; message?: string; configChanged?: boolean; setupLink?: { url: string; label: string }; [key: string]: unknown }
  | {
      type: 'qr';
      conversationId: string;
      qrcodeUrl?: string;
      qrPayload?: string;
      accountId?: string;
      statusAction?: string;
      cancelAction?: string;
      verificationCode?: string;
      botName?: string;
      setupHint?: string;
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
      confirmAction?: string;
      conversationId?: string;
      pinAction?: string;
      configChanged?: boolean;
      [key: string]: unknown;
    }
  | { type: 'diagnostics'; checks: Array<{ id?: string; label?: string; status?: string; message?: string }> }
  | {
      type: 'form';
      schema: JsonSchema;
      values?: Record<string, unknown>;
      submitAction: string;
      setupTemplate?: { content: string; url: string };
      setupLink?: { url: string; label: string };
      message?: string;
    };

type PollTarget = { actionId: string; conversationId: string; accountId?: string; intervalMs: number; cancelAction?: string };

function pollTarget(payload: ChannelActionPayload): PollTarget | null {
  if (payload.type !== 'qr' || !payload.statusAction) return null;
  return {
    actionId: payload.statusAction,
    conversationId: payload.conversationId,
    accountId: payload.accountId,
    cancelAction: payload.cancelAction,
    intervalMs: Math.max(1000, payload.pollIntervalMs ?? 2500),
  };
}

type ActionState = {
  payload: ChannelActionPayload | null;
  poll: PollTarget | null;
  busy: boolean;
  error: string | null;
  formDraft: Record<string, unknown>;
  generatedQr: string | null;
};

async function runChannelAction(params: {
  channelId: string;
  actionId: string;
  locale: string;
  accountId?: string;
  input?: unknown;
}): Promise<ChannelActionPayload> {
  const res = await apiFetch(apiUrl(`/api/channels/${encodeURIComponent(params.channelId)}/actions/${encodeURIComponent(params.actionId)}?locale=${encodeURIComponent(params.locale)}`), {
    method: 'POST',
    body: JSON.stringify({
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.input !== undefined ? { input: params.input } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    payload?: ChannelActionPayload;
    error?: { message?: string };
  };
  if (!res.ok || body.ok === false) {
    throw new Error(body.error?.message ?? res.statusText);
  }
  return body.payload ?? { type: 'ok' };
}

function isTerminalPoll(payload: ChannelActionPayload | null): boolean {
  return payload?.type === 'poll' && payload.phase !== 'pending';
}

function payloadMessage(payload: ChannelActionPayload | null): string | null {
  if (!payload) return null;
  if ('message' in payload && typeof payload.message === 'string') return payload.message;
  return null;
}

function payloadQrContent(payload: ChannelActionPayload | null, channelId: string): string | null {
  if (payload?.type !== 'qr' && payload?.type !== 'poll') return null;
  if (payload.qrPayload) return payload.qrPayload;
  // Weixin returns a scan URL, not an image URL; render it as a QR locally.
  if (channelId === 'weixin' && payload.qrcodeUrl) return payload.qrcodeUrl;
  return null;
}

function payloadQrImage(payload: ChannelActionPayload | null): string | null {
  if (payload?.type !== 'qr' && payload?.type !== 'poll') return null;
  return payload.qrcodeUrl ?? null;
}

export function ChannelSetupCard({
  entry,
  locale,
  messages: ch,
  onChanged,
  onStarted,
  compact = false,
  quick = false,
}: {
  entry: ChannelCatalogEntry;
  locale: string;
  messages: ChannelsSettingsMessages;
  onChanged: () => Promise<void> | void;
  onStarted?: () => void;
  compact?: boolean;
  quick?: boolean;
}) {
  const zh = locale.toLowerCase().startsWith('zh');
  const [domain, setDomain] = useState<'feishu' | 'lark'>('feishu');
  const [pin, setPin] = useState('');
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const primary = useMemo(() => choosePrimaryChannelAction(entry), [entry]);
  const schemaLabels = useMemo(() => ({
    defaultBooleanLabel: ch.schemaBooleanDefault,
    unsupportedArrayType: ch.schemaUnsupportedArrayType,
    arrayAddPlaceholder: ch.schemaArrayAddPlaceholder,
    unsupportedFieldType: (title: string, type?: string) => ch.schemaUnsupportedFieldType
      .replace('{{title}}', title)
      .replace('{{type}}', type ? ` (${type})` : ''),
  }), [ch]);
  const [state, setState] = useState<ActionState>({
    payload: null,
    poll: null,
    busy: false,
    error: null,
    formDraft: {},
    generatedQr: null,
  });

  const started = useRef(false);
  const mounted = useRef(false);
  const activePoll = useRef<PollTarget | null>(null);
  const cancelPoll = useCallback(async (poll: PollTarget | null) => {
    if (!poll?.cancelAction) return;
    await runChannelAction({
      channelId: entry.id,
      actionId: poll.cancelAction,
      locale,
      accountId: poll.accountId,
      input: { conversationId: poll.conversationId },
    });
  }, [entry.id, locale]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!quick) return;
    return () => {
      void cancelPoll(activePoll.current).catch(() => {});
    };
  }, [cancelPoll, quick]);

  const runAction = useCallback(async (actionId: string, input?: unknown, accountId?: string, replace = false) => {
    setState((prev) => ({ ...prev, busy: true, error: null, ...(replace ? { payload: null, poll: null } : {}) }));
    try {
      if (replace) {
        const oldPoll = activePoll.current;
        activePoll.current = null;
        await cancelPoll(oldPoll).catch(() => {});
      }
      setCopiedTemplate(false);
      const payload = await runChannelAction({ channelId: entry.id, actionId, locale, input, accountId });
      const nextPoll = pollTarget(payload);
      if (!mounted.current) {
        if (quick) void cancelPoll(nextPoll).catch(() => {});
        if ('configChanged' in payload && payload.configChanged === true) await onChanged();
        return;
      }
      if (nextPoll || payload.type !== 'poll' || payload.phase !== 'pending') activePoll.current = nextPoll;
      setState((prev) => ({
        ...prev,
        payload,
        poll: nextPoll ?? (payload.type === 'poll' && payload.phase === 'pending' ? prev.poll : null),
        busy: false,
        formDraft: payload.type === 'form' ? payload.values ?? {} : {},
      }));
      if ('configChanged' in payload && payload.configChanged === true) await onChanged();
    } catch (err) {
      if (mounted.current) setState((prev) => ({ ...prev, busy: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, [cancelPoll, entry.id, locale, onChanged, quick]);

  const startPrimary = (platform = domain, replace = false) => {
    if (!primary) return;
    onStarted?.();
    void runAction(primary[0], entry.id === 'feishu' ? { domain: platform } : undefined, undefined, replace);
  };

  const primaryId = primary?.[0];
  useEffect(() => {
    if (!quick || !primaryId || started.current) return;
    started.current = true;
    void runAction(primaryId, entry.id === 'feishu' ? { domain: 'feishu' } : undefined);
  }, [entry.id, primaryId, quick, runAction]);

  const qrContent = payloadQrContent(state.payload, entry.id);
  useEffect(() => {
    const content = qrContent;
    if (!content) {
      setState((prev) => (prev.generatedQr ? { ...prev, generatedQr: null } : prev));
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.generatedQr ? { ...prev, generatedQr: null } : prev));
    void QRCode.toDataURL(content, { width: 220, margin: 1 }).then((url) => {
      if (!cancelled) setState((prev) => ({ ...prev, generatedQr: url }));
    }).catch(() => {
      if (!cancelled) setState((prev) => ({ ...prev, error: ch.failed }));
    });
    return () => {
      cancelled = true;
    };
  }, [ch.failed, qrContent]);

  useEffect(() => {
    const poll = state.poll;
    if (!poll || state.busy) return;
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const next = await runChannelAction({
          channelId: entry.id,
          actionId: poll.actionId,
          accountId: poll.accountId,
          locale,
          input: { conversationId: poll.conversationId },
        });
        const nextPoll = pollTarget(next);
        if (cancelled) {
          if (quick && !mounted.current) void cancelPoll(nextPoll).catch(() => {});
          if ('configChanged' in next && next.configChanged === true) await onChanged();
          return;
        }
        if (nextPoll || isTerminalPoll(next)) activePoll.current = nextPoll;
        setState(prev => ({
          ...prev,
          payload: next.type === 'poll' && next.phase === 'pending' && prev.payload?.type === 'qr'
            ? { ...prev.payload, ...next, pinAction: next.pinAction, type: 'qr' }
            : next,
          poll: nextPoll ?? (isTerminalPoll(next) ? null : prev.poll),
          error: null,
        }));
        if ('configChanged' in next && next.configChanged === true) await onChanged();
        if (nextPoll || isTerminalPoll(next)) return;
      } catch (err) {
        if (!cancelled) setState(prev => ({ ...prev, error: err instanceof Error ? err.message : String(err) }));
      }
      if (!cancelled) timer = window.setTimeout(() => void check(), poll.intervalMs);
    };
    timer = window.setTimeout(() => void check(), poll.intervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cancelPoll, entry.id, locale, onChanged, quick, state.busy, state.poll]);

  const primaryLabel = primary?.[1].label ?? (entry.configured ? ch.reconnect : ch.connect);
  const doctorLabel = entry.actions?.['doctor.run']?.label ?? ch.diagnose;
  const message = payloadMessage(state.payload);
  const qrImage = qrContent ? state.generatedQr : payloadQrImage(state.payload);
  const verificationCode = state.payload?.type === 'qr' ? state.payload.verificationCode : undefined;
  const botName = state.payload?.type === 'qr' ? state.payload.botName : undefined;
  const setupHint = state.payload?.type === 'qr' ? state.payload.setupHint : undefined;
  const confirmAction = state.payload?.type === 'poll' ? state.payload.confirmAction : undefined;
  const pinAction = state.payload && 'pinAction' in state.payload && typeof state.payload.pinAction === 'string'
    ? state.payload.pinAction
    : undefined;
  const qrStageActive = Boolean(!pinAction && (qrContent || qrImage));
  const cancel = () => {
    const poll = state.poll;
    if (!poll?.cancelAction) return;
    setPin('');
    void runAction(poll.cancelAction, { conversationId: poll.conversationId }, poll.accountId);
  };
  const formPayload = state.payload?.type === 'form' ? state.payload : null;
  const setupLink = state.payload?.type === 'ok' || state.payload?.type === 'form' ? state.payload.setupLink : undefined;
  const formSchema = formPayload?.schema;
  const requiredSetupFields = Array.isArray(formSchema?.required)
    ? formSchema.required.filter((key): key is string => typeof key === 'string')
    : [];
  const formProperties = formSchema?.properties as Record<string, JsonSchema> | undefined;
  const quickFormSchema = formSchema && quick && formProperties && requiredSetupFields.length > 0
    ? {
      ...formSchema,
      properties: Object.fromEntries(
        [...requiredSetupFields, ...(entry.id === 'feishu' ? ['domain'] : [])]
          .filter((key) => Object.hasOwn(formProperties, key))
          .map((key, index) => [key, { ...formProperties[key], 'x-order': index }]),
      ),
    }
    : formSchema;
  const setupComplete = state.payload?.type === 'ok' && state.payload.configChanged === true;
  const terminalSuccess = state.payload?.type === 'poll' && state.payload.phase === 'done' && state.payload.ok;
  const allowManual = entry.actions?.['setup.manual'] && primary?.[0] !== 'setup.manual'
    && !formPayload && !setupComplete && !terminalSuccess
    && (!state.poll || (quick && state.poll.actionId === 'setup.status'));
  const canRetry = !state.poll && !formPayload && Boolean(state.error || isTerminalPoll(state.payload)) && !terminalSuccess;
  const scanApp = entry.id === 'feishu' ? (domain === 'lark' ? 'Lark' : zh ? '飞书' : 'Feishu') : entry.label;
  const missingSetupField = requiredSetupFields.some((field) => {
    const value = state.formDraft[field];
    return value == null || (typeof value === 'string' && !value.trim());
  });
  const diagnostics = state.payload?.type === 'diagnostics' ? state.payload.checks : null;

  return (
    <div className={compact || quick ? 'space-y-3' : 'rounded-lg bg-surface-panel/80 p-4 shadow-surface'}>
      <div className={cn('flex flex-wrap items-start gap-3', compact || quick ? 'justify-end' : 'justify-between')}>
        {!compact && !quick ? (
          <div>
            <h3 className="text-sm font-semibold text-fg">{ch.setupTitle}</h3>
            <p className="mt-1 text-sm text-fg-muted">
              {entry.configured ? ch.setupConfiguredHint : ch.setupEmptyHint}
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          {entry.id === 'feishu' && (quick
            ? !formPayload && !setupComplete && !terminalSuccess && (!state.poll || state.poll.actionId === 'setup.status')
            : !state.poll) ? (
            <SelectField
              label={zh ? '平台' : 'Platform'}
              value={domain}
              disabled={state.busy}
              onChange={(platform) => {
                setDomain(platform);
                if (quick) startPrimary(platform, true);
              }}
              options={[{ value: 'feishu', label: zh ? '飞书' : 'Feishu' }, { value: 'lark', label: 'Lark' }]}
            />
          ) : null}
          {primary && (quick ? canRetry : !state.poll) ? (
            <Button
              type="button"
              variant="primary"
              disabled={state.busy}
              onClick={() => startPrimary(domain, quick)}
            >
              {state.busy ? <Loader2 className="size-4 animate-spin" /> : primary[1].result === 'qr' ? <QrCode className="size-4" /> : <KeyRound className="size-4" />}
              {quick ? (primary[1].result === 'qr' ? ch.newSetupCode : ch.retry) : primaryLabel}
            </Button>
          ) : null}
          {!quick && allowManual ? (
            <Button
              type="button"
              variant="secondary"
              disabled={state.busy}
              onClick={() => {
                onStarted?.();
                void runAction('setup.manual', entry.id === 'feishu' ? { domain } : undefined);
              }}
            >
              {entry.actions?.['setup.manual']?.label}
            </Button>
          ) : null}
          {!quick && state.poll?.cancelAction ? (
            <Button type="button" variant="secondary" disabled={state.busy} onClick={cancel}>{zh ? '取消' : 'Cancel'}</Button>
          ) : null}
          {!quick && entry.actions?.['doctor.run'] && !state.poll ? (
            <Button
              type="button"
              variant="secondary"
              disabled={state.busy}
              onClick={() => void runAction('doctor.run')}
            >
              <Stethoscope className="size-4" />
              {doctorLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {quick && !state.payload && (state.busy || !state.error) ? (
        <div className="flex justify-center" aria-busy="true" role="status" aria-label={ch.loading}>
          <Skeleton className={primary?.[1].result === 'qr' ? 'size-52 rounded-lg' : 'h-24 w-full rounded-lg'} />
        </div>
      ) : null}
      {message && !(quick && (formPayload?.setupTemplate || (qrStageActive && primary?.[1].result === 'qr' && state.poll?.actionId !== 'setup.verify.status'))) && (!isTerminalPoll(state.payload) || confirmAction) ? <p className="mt-3 text-sm text-fg-muted">{message}</p> : null}
      {setupLink ? (
        <a className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline"
          href={setupLink.url} target="_blank" rel="noreferrer"
        >
          {setupLink.label}
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
      {botName ? <p className="mt-2 text-sm font-medium text-fg">{botName}</p> : null}
      {verificationCode ? <code className="mt-2 block select-all break-all rounded-md bg-surface-base p-2 text-sm">{verificationCode}</code> : null}
      {setupHint ? <p className="mt-2 text-sm text-fg-muted">{setupHint}</p> : null}
      {pinAction && state.poll ? (
        <form className="mt-3 flex items-end gap-2" onSubmit={event => {
          event.preventDefault();
          if (!state.poll) return;
          void runAction(pinAction, { conversationId: state.poll.conversationId, code: pin }, state.poll.accountId);
          setPin('');
        }}>
          <label className="flex flex-col gap-1 text-sm">
            {zh ? '微信验证码' : 'WeChat verification code'}
            <input className="ui-input h-9 rounded-md border border-edge bg-surface-base px-2" inputMode="numeric" autoComplete="one-time-code" value={pin} onChange={event => setPin(event.target.value)} />
          </label>
          <Button type="submit" disabled={state.busy || !/^\d{4,8}$/.test(pin)}>{zh ? '提交' : 'Submit'}</Button>
        </form>
      ) : null}
      {confirmAction && state.payload?.type === 'poll' ? (
        <Button type="button" className="mt-3" disabled={state.busy} onClick={() => {
          const payload = state.payload;
          if (payload?.type === 'poll') void runAction(confirmAction, { conversationId: payload.conversationId }, payload.accountId);
        }}>{zh ? '确认连接' : 'Confirm connection'}</Button>
      ) : null}
      {state.error ? <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}

      {qrStageActive ? (
        <div
          className={cn(
            'flex items-center justify-center gap-4 rounded-lg bg-surface-base p-3 shadow-surface',
            quick ? 'flex-col text-center' : 'mt-4 flex-col sm:flex-row',
            compact && !quick && 'mt-1 text-center sm:text-left',
          )}
        >
          <div className="flex size-56 shrink-0 items-center justify-center rounded-lg border border-edge bg-white p-3">
            {qrImage ? (
              <img src={qrImage} alt={`${entry.label} setup QR`} className="size-52 object-contain" />
            ) : (
              <div className="flex size-52 items-center justify-center rounded-md bg-surface-base">
                <Skeleton className="size-48 rounded-md" />
              </div>
            )}
          </div>
          <div className={cn('min-w-0 max-w-sm text-sm text-fg-muted', compact && 'w-full sm:w-auto')}>
            {qrImage ? (
              <p className="line-clamp-3">{quick && state.poll?.actionId !== 'setup.verify.status'
                ? ch.scanLoginHint.replace('{{channel}}', scanApp) : ch.waitingConfirmation}</p>
            ) : (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-4 w-36 max-w-full" />
              </div>
            )}
            {qrContent ? (
              <a
                className="mt-2 inline-flex items-center gap-1 text-accent hover:underline"
                href={qrContent}
                target="_blank"
                rel="noreferrer"
              >
                {ch.openSetupLink}
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.payload?.type === 'poll' && isTerminalPoll(state.payload) && !confirmAction ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface-base px-3 py-2 text-sm shadow-surface">
          <CheckCircle2 className={state.payload.ok ? 'size-4 text-green-600' : 'size-4 text-red-600'} />
          <span className={state.payload.ok ? 'text-fg' : 'text-red-600 dark:text-red-400'}>
            {state.payload.message ?? (state.payload.ok ? ch.complete : ch.failed)}
          </span>
        </div>
      ) : null}

      {formPayload ? (
        <div className="mt-4 space-y-3">
          <SchemaForm
            schema={quickFormSchema ?? formPayload.schema}
            values={state.formDraft}
            onChange={(next) => setState((prev) => ({ ...prev, formDraft: next }))}
            disabled={state.busy}
            labels={schemaLabels}
          />
          {formPayload.setupTemplate ? (
            <details open={!quick || undefined} className="space-y-2">
              <summary className="cursor-pointer text-sm text-accent">{ch.howToGetCredentials}</summary>
              {quick && message ? <p className="text-sm text-fg-muted">{message}</p> : null}
              <textarea
                readOnly
                aria-label="App Manifest"
                value={formPayload.setupTemplate.content}
                className="h-28 w-full resize-y rounded-md border border-edge bg-surface-base p-2 font-mono text-xs text-fg"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    const template = formPayload.setupTemplate;
                    if (template) setCopiedTemplate(await copyTextToClipboard(template.content));
                  }}
                >
                  {copiedTemplate ? (zh ? '已复制' : 'Copied') : (zh ? '复制 App Manifest' : 'Copy App Manifest')}
                </Button>
                <a className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                  href={formPayload.setupTemplate.url} target="_blank" rel="noreferrer"
                >
                  {zh ? '打开 Slack 应用管理' : 'Open Slack apps'}
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            </details>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={state.busy || missingSetupField}
            onClick={() => void runAction(formPayload.submitAction, state.formDraft)}
          >
            {quick ? ch.verifyAndConnect : ch.saveSetup}
          </Button>
        </div>
      ) : null}

      {quick && allowManual ? (
        <Button type="button" variant="ghost" className="min-h-11" disabled={state.busy}
          onClick={() => void runAction('setup.manual', entry.id === 'feishu' ? { domain } : undefined, undefined, true)}
        >
          {ch.useSetupCredentials}
        </Button>
      ) : null}
      {quick && formPayload && primary?.[1].result === 'qr' ? (
        <Button type="button" variant="ghost" className="min-h-11" disabled={state.busy}
          onClick={() => startPrimary(domain, true)}
        >
          {ch.scanToConnect}
        </Button>
      ) : null}
      {quick && setupComplete ? (
        <p role="status" className="text-sm text-fg-muted">{ch.setupSaved} {ch.testMessageHint}</p>
      ) : null}

      {diagnostics ? (
        <div className="mt-4 space-y-2">
          {diagnostics.map((check, index) => (
            <div key={check.id ?? index} className="rounded-lg bg-surface-base px-3 py-2 shadow-surface">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-fg">{check.label ?? check.id ?? ch.diagnosticCheckFallback.replace('{{index}}', String(index + 1))}</p>
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
