import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { ConnectorsSettingsMessages, McpSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { applyMcpAuthDraft, createMcpAuthDraft, invalidMcpHeaderIndex, type McpAuthDraft } from './mcp/mcp-auth-draft';
import { McpAuthFields, McpHeaderFields, mcpInputClass } from './mcp/mcp-auth-fields';
import {
  buildMcpServerConfigFromRow, cancelMcpDraftSignIn, commitMcpDraft, createMcpConnectionDraft, deleteMcpDraft, normalizeMcpAddress, parseMcpConfigImport,
  probeMcpDraft, readMcpDraftSignIn, startMcpDraftSignIn, submitMcpDraftRedirect, suggestMcpServerId,
  type McpAuthorization, type McpConnectionProbe, type McpServerRow,
} from './mcp/mcp-config-api';
import { mcpServerEndpointSummary } from './mcp/mcp-server-endpoint-summary';
import { McpServerFormFields } from './mcp/mcp-server-form-fields';
import { McpToolsDialog } from './mcp/mcp-tools-dialog';

function connectionFailure(error: unknown, t: McpSettingsMessages): string {
  const detail = error as { status?: number; errorCode?: string; error?: string } | undefined;
  if (detail?.status === 429) return t.setupRateLimited;
  if (detail?.status === 401) return t.setupGatewayUnauthorized;
  if (detail?.status === 404 || detail?.status === 409) return t.setupConflict;
  if (detail?.status && detail.status >= 500) return t.setupGatewayCheckFailed;
  const categories: Record<string, string> = {
    command_missing: t.setupCommandMissing, connection_refused: t.setupConnectionRefused, host_not_found: t.setupHostNotFound,
    timeout: t.setupTimedOut, access_denied: t.setupAccessDenied, network: t.setupServiceNetworkFailed,
    tls: t.setupTlsFailed, invalid_response: t.setupInvalidResponse, not_found: t.setupEndpointNotFound,
    rate_limited: t.setupServiceRateLimited, configuration: t.setupInvalidConfig,
  };
  if (detail?.errorCode && Object.hasOwn(categories, detail.errorCode)) return categories[detail.errorCode];
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : detail?.error ?? '';
  if (/ENOENT|command not found|executable.{0,30}not found/i.test(message)) return t.setupCommandMissing;
  if (/ECONNREFUSED|connection refused/i.test(message)) return t.setupConnectionRefused;
  if (/ENOTFOUND|EAI_AGAIN|could not resolve/i.test(message)) return t.setupHostNotFound;
  if (/timeout|timed out/i.test(message)) return t.setupTimedOut;
  if (/fetch failed|failed to fetch|network error|NetworkError/i.test(message)) return detail?.error !== undefined ? t.setupServiceNetworkFailed : t.setupGatewayNetworkFailed;
  if (/\b(?:401|403)\b|unauthorized|forbidden|permission denied/i.test(message)) return t.setupAccessDenied;
  return t.setupCheckFailed;
}

function signature(row: McpServerRow, auth: McpAuthDraft): string {
  return JSON.stringify({ id: row.id, config: buildMcpServerConfigFromRow(applyMcpAuthDraft(row, auth)) });
}
function draftSignature(row: McpServerRow, auth: McpAuthDraft): string {
  try { return signature(row, auth); } catch { return JSON.stringify({ row, auth }); }
}

export function CustomMcpServerDialog(props: { open: boolean; mode: 'add' | 'edit'; initialRow: McpServerRow;
  existingCustomServers: McpServerRow[]; config: unknown; managedServerIds: ReadonlySet<string>;
  t: McpSettingsMessages; cs: ConnectorsSettingsMessages; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, cs } = props;
  const validationId = useId();
  const [row, setRow] = useState(props.initialRow);
  const [auth, setAuth] = useState(() => createMcpAuthDraft(props.initialRow));
  const [phase, setPhase] = useState<'saving' | 'checking' | 'idle'>('idle');
  const [error, setError] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);
  const [validation, setValidation] = useState<{ field: string; message: string; focus?: boolean }>();
  const [probe, setProbe] = useState<McpConnectionProbe>();
  const [authorization, setAuthorization] = useState<McpAuthorization>();
  const [advanced, setAdvanced] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [imports, setImports] = useState<McpServerRow[]>([]);
  const [selectedImport, setSelectedImport] = useState('0');
  const [formRevision, setFormRevision] = useState(0);
  const [redirect, setRedirect] = useState('');
  const [showTools, setShowTools] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const saved = props.mode === 'edit';
  const [testedSignature, setTestedSignature] = useState('');
  const draftId = useRef<string | undefined>(undefined);
  const [savedSignature] = useState(() => draftSignature(props.initialRow, createMcpAuthDraft(props.initialRow)));
  const savedId = useRef(props.mode === 'edit' ? props.initialRow.id : '');
  const operation = useRef<AbortController | undefined>(undefined);
  const polling = useRef<AbortController | undefined>(undefined);
  const attemptId = useRef<string | undefined>(undefined);
  const popup = useRef<Window | null>(null);
  const openedUrl = useRef('');
  const mounted = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const onSaved = useRef(props.onSaved);
  onSaved.current = props.onSaved;
  const authorizing = authorization?.state === 'starting' || authorization?.state === 'authorizing';
  const busy = phase !== 'idle' || authorizing;
  const dirty = savedSignature !== draftSignature(row, auth);
  const disabled = row.extra.enabled === false;
  const unsaved = !reloadRequired && (dirty || Boolean(importText.trim()));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      popup.current?.close();
      if (draftId.current) void deleteMcpDraft(draftId.current).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!unsaved) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [unsaved]);

  useEffect(() => {
    if (!validation) return;
    const target = form.current?.querySelector<HTMLElement>(`[data-field="${validation.field}"]`);
    const details = target?.closest('details');
    if (details) details.open = true;
    const control = target?.querySelector<HTMLElement>('input,button,textarea') ?? target;
    control?.setAttribute('aria-invalid', 'true');
    control?.setAttribute('aria-describedby', validationId);
    if (validation.focus !== false) (control ?? alert.current)?.focus();
    return () => { control?.removeAttribute('aria-invalid'); control?.removeAttribute('aria-describedby'); };
  }, [validation, validationId]);

  useEffect(() => {
    if (!authorization || !authorizing) return;
    const controller = new AbortController(); polling.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await readMcpDraftSignIn(draftId.current!, controller.signal);
        if (controller.signal.aborted) return;
        setAuthorization(result);
        if (result.authorizationUrl && openedUrl.current !== result.authorizationUrl) {
          openedUrl.current = result.authorizationUrl;
          if (window.electronAPI?.shell?.openExternalUrl) {
            const opened = await window.electronAPI.shell.openExternalUrl(result.authorizationUrl);
            if (!opened.ok && !controller.signal.aborted) setError(t.oauthOpenFailed);
          } else if (popup.current && !popup.current.closed) popup.current.location.replace(result.authorizationUrl);
        }
        if (controller.signal.aborted) return;
        if (result.state === 'connected') {
          attemptId.current = undefined; popup.current?.close();
          setProbe({ state: 'connected', toolCount: result.toolCount }); setError('');
          return;
        }
        if (result.state === 'error' || result.state === 'cancelled') {
          attemptId.current = undefined; popup.current?.close();
          setError(result.state === 'cancelled' ? t.setupCancelled : t.setupAuthFailed);
          if (/client.{0,20}(id|registration)|register|registration/i.test(result.error ?? '')) setAdvanced(true);
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        clearResult(); popup.current?.close(); setError(t.setupAuthFailed);
        return;
      }
      timer = setTimeout(() => void poll(), 1_200);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [authorization?.id, authorizing, t.oauthOpenFailed, t.setupCancelled, t.setupAuthFailed]);

  function clearResult() {
    operation.current?.abort(); polling.current?.abort();
    if (draftId.current) void deleteMcpDraft(draftId.current).catch(() => {});
    draftId.current = undefined; setTestedSignature(''); setShowTools(false);
    setProbe(undefined); setAuthorization(undefined); setError(''); setValidation(undefined); }
  function update(patch: Partial<McpServerRow>) { setRow(current => ({ ...current, ...patch })); clearResult(); }
  function updateAuth(patch: Partial<McpAuthDraft>) { setAuth(current => ({ ...current, ...patch })); clearResult(); }
  function close() {
    if (busy) return;
    if (unsaved) setConfirmClose(true); else props.onClose();
  }
  function previewImport() {
    try { setImports(parseMcpConfigImport(importText)); setSelectedImport('0'); setImportError(''); }
    catch { setImportError(t.setupImportError); setImports([]); }
  }
  function applyImport() {
    const selected = imports[Number(selectedImport)];
    if (!selected) return;
    const next = { ...selected, id: savedId.current || selected.id, clientKey: props.initialRow.clientKey,
      extra: { ...selected.extra, ...(savedId.current ? { enabled: row.extra.enabled } : {}) } };
    setRow(next); setAuth(createMcpAuthDraft(next)); clearResult();
    setFormRevision(current => current + 1); setImporting(false); setImportText(''); setImports([]);
  }
  function validate(next: McpServerRow): boolean {
    function invalid(field: string, message: string) { setValidation({ field, message }); return false; }
    if (next.transport === 'streamable-http') {
      try { next.url = normalizeMcpAddress(next.url); } catch { return invalid('url', t.setupAddressInvalid); }
      if ((auth.mode === 'bearer' && !auth.token.trim().replace(/^Bearer\s*/i, '')) || (auth.mode === 'apiKey' && (!auth.apiKey.trim() || !auth.headerName.trim()))) return invalid('auth', t.setupCredentialRequired);
      if (invalidMcpHeaderIndex(next.headers) >= 0) return invalid('auth', t.setupHeaderInvalid);
      if (auth.mode === 'oauth' && next.headers.some(header => header.key.trim().toLowerCase() === 'authorization')) return invalid('auth', t.setupOAuthHeaderConflict);
      if (auth.mode === 'headers' && !next.headers.some(header => header.key.trim() && (header.value.trim() || header.reference))) return invalid('auth', t.setupCredentialRequired);
    } else {
      if (!next.command.trim()) return invalid('command', t.setupCommandRequired);
    }
    if (next.timeout !== undefined && (!Number.isFinite(next.timeout) || next.timeout <= 0)) return invalid('advanced', t.setupInvalidConfig);
    try { buildMcpServerConfigFromRow(next); } catch (error) { return invalid(next.transport === 'stdio' ? 'commandOptions' : 'advanced', error instanceof Error && error.message.startsWith('Environment') ? t.setupEnvInvalid : t.setupInvalidConfig); }
    return true;
  }
  async function signIn() {
    setError(''); setPhase('checking'); openedUrl.current = '';
    if (!window.electronAPI?.shell?.openExternalUrl) {
      popup.current = window.open('about:blank', '_blank');
      if (popup.current) popup.current.opener = null;
    }
    try {
      const attempt = await startMcpDraftSignIn(draftId.current!);
      if (!mounted.current) { popup.current?.close(); if (draftId.current) void deleteMcpDraft(draftId.current).catch(() => {}); return; }
      attemptId.current = attempt.id; setAuthorization(attempt);
    } catch { popup.current?.close(); if (mounted.current) setError(t.setupAuthFailed); }
    finally { if (mounted.current) setPhase('idle'); }
  }
  async function connect() {
    const next = applyMcpAuthDraft(row, auth);
    if (!validate(next)) return;
    const others = props.existingCustomServers.filter(item => item.clientKey !== props.initialRow.clientKey && item.id !== savedId.current);
    const occupied = new Set([...props.managedServerIds, ...others.map(item => item.id)]);
    next.id = savedId.current || next.id.trim() || suggestMcpServerId(next, occupied);
    if (!/^[a-zA-Z0-9_-]+$/.test(next.id) || [...occupied].some(id => id.replace(/-/g, '_') === next.id.replace(/-/g, '_'))) {
      setValidation({ field: 'advanced', message: cs.duplicateServerId }); return;
    }
    clearResult(); setPhase('checking');
    const controller = new AbortController(); operation.current = controller;
    try {
      const draft = await createMcpConnectionDraft(next, savedId.current || undefined, props.initialRow.extra, controller.signal);
      if (!mounted.current || controller.signal.aborted) { void deleteMcpDraft(draft.id).catch(() => {}); return; }
      draftId.current = draft.id; setRow(next); setTestedSignature(draftSignature(next, auth));
      const result = await probeMcpDraft(draft.id, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setProbe(result);
      if (result.state === 'error') setError(connectionFailure(result, t));
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError((error as { status?: number }).status === 409 ? t.setupConflict : connectionFailure(error, t));
    } finally { if (mounted.current && operation.current === controller) setPhase('idle'); }
  }
  async function save(enable = false) {
    if (!draftId.current || probe?.state !== 'connected' || testedSignature !== draftSignature(row, auth)) return;
    setPhase('saving'); setError('');
    try {
      const result = await commitMcpDraft(draftId.current, enable);
      draftId.current = undefined;
      await onSaved.current().catch(() => {});
      if (result?.reloadRequired) setReloadRequired(true);
      else props.onClose();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 409) { clearResult(); setError(t.setupConflict); }
      else setError(t.setupSaveFailed);
    } finally { if (mounted.current) setPhase('idle'); }
  }
  async function cancelAuthorization() {
    polling.current?.abort();
    const id = draftId.current;
    attemptId.current = undefined; setAuthorization(undefined); popup.current?.close(); setError(t.setupCancelled); setPhase('checking');
    try { if (id) await cancelMcpDraftSignIn(id); }
    catch { if (mounted.current) { clearResult(); setError(t.setupCancelled); } }
    finally { if (mounted.current) setPhase('idle'); }
  }
  async function openAuthorization() {
    if (!authorization?.authorizationUrl) return;
    if (window.electronAPI?.shell?.openExternalUrl) {
      const result = await window.electronAPI.shell.openExternalUrl(authorization.authorizationUrl);
      if (!result.ok) setError(t.oauthOpenFailed);
    } else window.open(authorization.authorizationUrl, '_blank', 'noopener,noreferrer');
  }
  async function submitRedirect() {
    if (!authorization) return;
    try { await submitMcpDraftRedirect(draftId.current!, redirect); setRedirect(''); setError(''); }
    catch { setError(t.setupRedirectInvalid); }
  }
  const canSignIn = Boolean(draftId.current) && testedSignature === draftSignature(row, auth) && (auth.mode === 'oauth' || auth.mode === 'auto' && probe?.state === 'oauth_required') && probe?.state !== 'connected';
  const localAddress = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(row.url.trim());
  const selected = imports[Number(selectedImport)];

  return <><Dialog.Root open={props.open} onOpenChange={open => { if (!open) close(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[60] bg-scrim" />
    <Dialog.Content ref={dialog} tabIndex={-1} className="fixed left-1/2 top-1/2 z-[60] flex h-[min(44rem,calc(100dvh-2rem))] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay"
      onOpenAutoFocus={event => { event.preventDefault(); dialog.current?.focus(); }}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge p-5">
        <div><Dialog.Title className="font-semibold">{props.mode === 'edit' ? t.setupEditTitle : t.setupTitle}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.setupHint}</Dialog.Description></div>
        <button type="button" disabled={busy} onClick={close} className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover disabled:opacity-50" aria-label={cs.modalClose}><X className="size-5" aria-hidden /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
        {importing ? <div className="space-y-4">
          <Button variant="ghost" onClick={() => setImporting(false)}>{t.setupImportBack}</Button>
          <p className="text-sm text-fg-muted">{t.setupImportEmpty}</p>
          <label className="block text-sm font-medium text-fg">{t.setupImport}<textarea className={cn(mcpInputClass, 'mt-1.5 min-h-40 font-mono text-xs')} value={importText}
            placeholder={'{"mcpServers": {"docs": {"url": "https://example.com/mcp"}}}'} onChange={event => { setImportText(event.target.value); setImports([]); setImportError(''); }} /></label>
          <Button variant="secondary" disabled={!importText.trim()} onClick={previewImport}>{t.setupImportPreview}</Button>
          {importError ? <p role="alert" className="text-sm text-danger">{importError}</p> : null}
          {selected ? <div className="space-y-3 rounded-lg border border-edge p-4">
            <p className="text-sm text-fg-muted">{t.setupImportScope}</p>
            <label className="block text-sm font-medium">{t.setupImportChoose}<Select aria-label={t.setupImportChoose} className={cn(mcpInputClass, 'mt-1.5')} value={selectedImport} onChange={event => setSelectedImport(event.target.value)}>
              {imports.map((item, index) => <SelectOption key={index} value={String(index)}>{item.displayName || item.id || mcpServerEndpointSummary(item)}</SelectOption>)}
            </Select></label>
            <p className="break-all text-sm text-fg-muted">{selected.transport === 'stdio' ? t.setupUseCommand : t.setupUseUrl} · {mcpServerEndpointSummary(selected)}</p>
          </div> : null}
        </div> : <form ref={form} noValidate onBlurCapture={event => {
          if (event.target instanceof HTMLInputElement && event.target.dataset.field === 'url' && row.url.trim()) {
            try { normalizeMcpAddress(row.url); } catch { setValidation({ field: 'url', message: t.setupAddressInvalid, focus: false }); }
          }
        }} onSubmit={event => { event.preventDefault(); void connect(); }}>
          <fieldset disabled={busy || reloadRequired} className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1" role="group" aria-label={t.transportLabel}>
                {(['streamable-http', 'stdio'] as const).map(transport => <Button key={transport} type="button" variant={row.transport === transport ? 'secondary' : 'ghost'} aria-pressed={row.transport === transport}
                  onClick={() => update({ transport })}>{transport === 'stdio' ? t.setupUseCommand : t.setupUseUrl}</Button>)}
              </div>
              <Button type="button" variant="ghost" onClick={() => setImporting(true)}>{t.setupImport}</Button>
            </div>
            <div><McpServerFormFields key={`${row.transport}-${formRevision}`} row={row} t={t} variant="basic" onUpdate={update} /></div>
            {row.transport === 'streamable-http' ? <div data-field="auth"><McpAuthFields allowExisting={Boolean(row.extra.auth) || row.headers.some(header => Boolean(header.reference))} draft={auth} onChange={updateAuth} t={t} /></div> : null}
            {validation ? <p id={validationId} ref={alert} tabIndex={-1} role="alert" className="text-sm text-danger">{validation.message}</p> : null}
            <details data-field="advanced" className="rounded-lg border border-edge p-3" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
              <summary className="cursor-pointer text-sm font-medium text-fg-muted">{t.setupAdvanced}</summary>
              <div className="mt-4 space-y-4"><McpServerFormFields row={row} t={t} variant="advanced" idReadOnly={saved} showOAuth={auth.mode === 'oauth'} onUpdate={update} />
                {row.transport === 'streamable-http' && auth.mode !== 'headers' && auth.mode !== 'existing' ? <McpHeaderFields additional headers={auth.additionalHeaders} onChange={additionalHeaders => updateAuth({ additionalHeaders })} t={t} /> : null}
              </div>
            </details>
            <p className="text-xs leading-relaxed text-fg-muted">{row.transport === 'stdio' ? t.setupCommandHostHint : localAddress ? t.setupLocalhostHint : t.setupGatewayHint}</p>
            <p className="text-xs text-fg-muted">{t.setupTestNotice}</p>
          </fieldset>
          <button type="submit" hidden />
        </form>}
        {reloadRequired ? <p role="alert" className="mt-4 text-sm text-fg">{t.setupReloadRequired}</p> : null}
        {!importing && !reloadRequired ? <div className="mt-4 space-y-3" aria-live="polite">
          {phase !== 'idle' ? <p role="status" className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{phase === 'saving' ? t.setupSaving : t.setupChecking}</p> : null}
          {phase === 'idle' && saved && !dirty && !probe && !error && !authorizing ? <p role="status" className="text-sm text-fg-muted">{disabled ? t.setupDisabled : t.setupSavedUnchecked}</p> : null}
          {probe?.state === 'connected' ? <div className="space-y-2"><p role="status" className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4 shrink-0" aria-hidden />{probe.toolCount ? t.setupConnected.replace('{{count}}', String(probe.toolCount)) : t.setupZeroTools}</p>
            <Button variant="secondary" onClick={() => setShowTools(true)}>{t.viewTools}</Button></div> : null}
          {probe?.state === 'token_required' ? <p role="status" className="text-sm text-fg-muted">{t.setupNeedsAuth}</p> : null}
          {probe?.state === 'oauth_required' && !authorizing ? <p className="text-sm text-fg-muted">{t.setupOAuthRequired}</p> : null}
          {authorizing ? <div className="space-y-3 rounded-lg border border-edge p-4">
            <p role="status" className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t.setupAuthorizing}</p>
            <div className="flex flex-wrap gap-2">{authorization?.authorizationUrl ? <Button variant="secondary" onClick={() => void openAuthorization()}><ExternalLink className="size-4" aria-hidden />{t.oauthOpenAuthorization}</Button> : null}
              <Button variant="ghost" onClick={() => void cancelAuthorization()}>{t.setupCancelAuth}</Button></div>
            {authorization?.acceptsRedirect ? <details><summary className="cursor-pointer text-sm text-accent-fg">{t.setupRemoteFallback}</summary>
              <p className="mt-2 text-xs text-fg-muted">{t.setupRedirectHint}</p>
              <label className="mt-2 block text-sm">{t.setupRedirectLabel}<input className={mcpInputClass} value={redirect} onChange={event => setRedirect(event.target.value)} /></label>
              <Button className="mt-2" disabled={!redirect.trim()} onClick={() => void submitRedirect()}>{t.setupContinue}</Button>
            </details> : null}
          </div> : null}
          {error ? <div role="alert" className="space-y-1 text-sm"><p className="text-danger">{error}</p>{error !== t.setupSaveFailed && phase !== 'saving' ? <p className="text-fg-muted">{t.setupTestFailure}</p> : null}</div> : null}
        </div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge p-4">
        <Button variant="secondary" disabled={busy} onClick={close}>{saved || reloadRequired ? t.setupClose : cs.modalCancel}</Button>
        {reloadRequired ? null : importing ? <Button variant="primary" disabled={!selected} onClick={applyImport}>{t.setupImportApply}</Button>
          : <>
            <Button variant={probe?.state === 'connected' ? 'secondary' : 'primary'} disabled={busy} onClick={() => canSignIn ? void signIn() : void connect()}>
              {canSignIn ? t.setupSignIn : t.setupTestConnection}
            </Button>
            {probe?.state === 'connected' && testedSignature === draftSignature(row, auth) ? <>
              {disabled ? <Button variant="secondary" disabled={busy} onClick={() => void save(true)}>{t.setupEnableSave}</Button> : null}
              <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => void save()}>{saved ? t.setupSaveOnly : t.setupAddConnection}</Button>
            </> : null}
          </>}
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
    <ConfirmDialog open={confirmClose} title={t.setupUnsavedTitle} description={t.setupUnsavedHint} confirmLabel={t.setupDiscard} cancelLabel={t.setupKeepEditing}
      onCancel={() => setConfirmClose(false)} onConfirm={props.onClose} overlayClassName="z-[70]" contentClassName="z-[70]" />
    {showTools ? <McpToolsDialog draftId={draftId.current} serverId={row.id} t={t} onClose={() => setShowTools(false)} /> : null}
  </>;
}
