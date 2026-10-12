import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { ConnectorsSettingsMessages, McpSettingsMessages } from '@/i18n/messages';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';

import { createMcpHeaderEntry } from './mcp/mcp-headers-utils';
import {
  cancelMcpSignIn, extractManagedMcpServers, normalizeMcpAddress, parseMcpConfigImport, patchMcpSettings,
  probeMcpServer, readMcpSignIn, startMcpSignIn, submitMcpSignInRedirect, suggestMcpServerId,
  type McpAuthorization, type McpConnectionProbe, type McpServerRow,
} from './mcp/mcp-config-api';
import { McpServerFormFields } from './mcp/mcp-server-form-fields';

const inputClass = cn('w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg', settingsInputFocusClass);

export function CustomMcpServerDialog(props: { open: boolean; mode: 'add' | 'edit'; initialRow: McpServerRow;
  existingCustomServers: McpServerRow[]; config: unknown; managedServerIds: ReadonlySet<string>;
  t: McpSettingsMessages; cs: ConnectorsSettingsMessages; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, cs } = props;
  const [row, setRow] = useState(props.initialRow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [probe, setProbe] = useState<McpConnectionProbe>();
  const [authorization, setAuthorization] = useState<McpAuthorization>();
  const [advanced, setAdvanced] = useState(false);
  const [importText, setImportText] = useState('');
  const [imports, setImports] = useState<McpServerRow[]>([]);
  const [redirect, setRedirect] = useState('');
  const [token, setToken] = useState('');
  const savedId = useRef(props.mode === 'edit' ? props.initialRow.id : '');
  const operation = useRef<AbortController | undefined>(undefined);
  const attemptId = useRef<string | undefined>(undefined);
  const popup = useRef<Window | null>(null);
  const openedUrl = useRef('');
  const mounted = useRef(true);
  const onSaved = useRef(props.onSaved);
  onSaved.current = props.onSaved;
  const authorizing = authorization?.state === 'starting' || authorization?.state === 'authorizing';
  const busy = saving || authorizing;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      popup.current?.close();
      if (attemptId.current) void cancelMcpSignIn(attemptId.current).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!authorization || !authorizing) return;
    const id = authorization.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await readMcpSignIn(id, controller.signal);
        if (controller.signal.aborted) return;
        setAuthorization(result);
        if (result.authorizationUrl && openedUrl.current !== result.authorizationUrl) {
          openedUrl.current = result.authorizationUrl;
          if (window.electronAPI?.shell?.openExternalUrl) {
            const opened = await window.electronAPI.shell.openExternalUrl(result.authorizationUrl);
            if (!opened.ok) setError(opened.error ?? t.oauthOpenFailed);
          } else if (popup.current && !popup.current.closed) popup.current.location.replace(result.authorizationUrl);
        }
        if (result.state === 'connected') {
          attemptId.current = undefined;
          popup.current?.close();
          setProbe({ state: 'connected', toolCount: result.toolCount });
          setError('');
          await onSaved.current();
          return;
        }
        if (result.state === 'error' || result.state === 'cancelled') {
          popup.current?.close();
          setError(result.error ?? t.setupCancelled);
          if (/client.{0,20}(id|registration)|register|registration/i.test(result.error ?? '')) setAdvanced(true);
          return;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : String(error));
        setAuthorization(current => current ? { ...current, state: 'error' } : undefined);
        if (attemptId.current) void cancelMcpSignIn(attemptId.current).catch(() => {});
        return;
      }
      timer = setTimeout(() => void poll(), 1_200);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [authorization?.id, authorizing, t.oauthOpenFailed, t.setupCancelled]);

  function update(patch: Partial<McpServerRow>) {
    setRow(current => ({ ...current, ...patch }));
    setProbe(undefined); setAuthorization(undefined); setError('');
  }
  function importConfig() {
    try {
      const rows = parseMcpConfigImport(importText);
      setImports(rows);
      update({ ...rows[0], clientKey: props.initialRow.clientKey });
      setImportText('');
    } catch (error) { setError(`${t.setupImportError} ${error instanceof Error ? error.message : String(error)}`); }
  }
  async function connect() {
    setSaving(true); setError(''); setAuthorization(undefined);
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    try {
      const others = props.existingCustomServers.filter(item => item.clientKey !== props.initialRow.clientKey && item.id !== savedId.current);
      const next = { ...row, url: row.transport === 'streamable-http' ? normalizeMcpAddress(row.url) : row.url };
      if (next.transport === 'stdio' && !next.command.trim()) throw new Error(t.setupCommandRequired);
      const occupied = new Set([...props.managedServerIds, ...others.map(item => item.id)]);
      next.id = next.id.trim() || suggestMcpServerId(next, occupied);
      if ([...occupied].some(id => id.replace(/-/g, '_') === next.id.replace(/-/g, '_'))) throw new Error(cs.duplicateServerId);
      next.extra = { ...next.extra, enabled: true };
      await patchMcpSettings({ servers: [...others, next] }, extractManagedMcpServers(props.config));
      savedId.current = next.id;
      if (!mounted.current) return;
      setRow(next);
      await onSaved.current();
      const result = await probeMcpServer(next.id, controller.signal);
      if (!mounted.current) return;
      setProbe(result);
      if (result.state === 'error') setError(result.error ?? t.setupConnectionFailed);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    } finally { if (mounted.current) setSaving(false); }
  }
  async function signIn() {
    setError(''); setSaving(true); openedUrl.current = '';
    if (!window.electronAPI?.shell?.openExternalUrl) {
      popup.current = window.open('about:blank', '_blank');
      if (popup.current) popup.current.opener = null;
    }
    try {
      const attempt = await startMcpSignIn(savedId.current);
      if (!mounted.current) { popup.current?.close(); void cancelMcpSignIn(attempt.id).catch(() => {}); return; }
      attemptId.current = attempt.id;
      setAuthorization(attempt);
    } catch (error) { popup.current?.close(); setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setSaving(false); }
  }
  async function openAuthorization() {
    const url = authorization?.authorizationUrl;
    if (!url) return;
    if (window.electronAPI?.shell?.openExternalUrl) {
      const result = await window.electronAPI.shell.openExternalUrl(url);
      if (!result.ok) setError(result.error ?? t.oauthOpenFailed);
    } else window.open(url, '_blank', 'noopener,noreferrer');
  }
  async function submitRedirect() {
    if (!authorization) return;
    setError('');
    try { await submitMcpSignInRedirect(authorization.id, redirect); setRedirect(''); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  function setBearerToken(value: string) {
    setToken(value);
    setRow(current => ({ ...current, headers: [
      ...current.headers.filter(header => header.key.toLowerCase() !== 'authorization'),
      ...(value.trim() ? [createMcpHeaderEntry('Authorization', /^Bearer\s/i.test(value.trim()) ? value.trim() : `Bearer ${value.trim()}`)] : []),
    ] }));
    setError('');
  }

  return <Dialog.Root open={props.open} onOpenChange={open => { if (!open) props.onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[60] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] flex h-[min(42rem,calc(100dvh-2rem))] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge p-5">
        <div><Dialog.Title className="font-semibold">{t.setupTitle}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.setupHint}</Dialog.Description></div>
        <Dialog.Close asChild><button className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover" aria-label={cs.modalClose}><X className="size-5" aria-hidden /></button></Dialog.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => update({ transport: row.transport === 'stdio' ? 'streamable-http' : 'stdio' })}>
              {row.transport === 'stdio' ? t.setupUseUrl : t.setupUseCommand}
            </Button>
          </div>
          <McpServerFormFields row={row} t={t} variant="basic" showTransport={false} onUpdate={update} />
          {probe?.state === 'token_required' ? <label className="block space-y-1.5 text-sm font-medium text-fg">
            <span>{t.setupTokenLabel}</span>
            <input type="password" autoComplete="off" className={inputClass} value={token} onChange={event => setBearerToken(event.target.value)} />
            <span className="block text-xs font-normal text-fg-muted">{t.setupTokenHint}</span>
          </label> : null}
          <details className="rounded-lg border border-edge p-3" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium text-fg-muted">{t.setupAdvanced}</summary>
            <div className="mt-4"><McpServerFormFields row={row} t={t} variant="advanced" onUpdate={update} /></div>
          </details>
          <details className="rounded-lg border border-edge p-3">
            <summary className="cursor-pointer text-sm font-medium text-fg-muted">{t.setupImport}</summary>
            <label className="mt-3 block"><span className="sr-only">{t.setupImport}</span>
              <textarea className={cn(inputClass, 'min-h-28 font-mono text-xs')} placeholder={'{"mcpServers": {"docs": {"url": "https://example.com/mcp"}}}'} value={importText} onChange={event => setImportText(event.target.value)} /></label>
            <Button variant="secondary" className="mt-2" disabled={!importText.trim()} onClick={importConfig}>{t.setupImportAction}</Button>
            {imports.length > 1 ? <label className="mt-3 block text-sm text-fg"><span>{t.setupImportChoose}</span>
              <Select className={cn(inputClass, 'mt-1.5')} value={row.id} onChange={event => {
                const selected = imports.find(item => item.id === event.target.value);
                if (selected) update({ ...selected, clientKey: props.initialRow.clientKey });
              }}>{imports.map(item => <SelectOption key={item.id} value={item.id}>{item.id}</SelectOption>)}</Select></label> : null}
          </details>
        </fieldset>
        {saving ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" aria-hidden />{t.setupChecking}</p> : null}
        {probe?.state === 'connected' ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden />{t.setupConnected.replace('{{count}}', String(probe.toolCount ?? 0))}</p> : null}
        {probe?.state === 'oauth_required' && !authorizing && authorization?.state !== 'connected' ? <p className="mt-4 text-sm text-fg-muted">{t.setupOAuthRequired}</p> : null}
        {authorizing ? <div className="mt-4 space-y-3 rounded-lg border border-edge p-4">
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" aria-hidden />{t.setupAuthorizing}</p>
          {authorization?.authorizationUrl ? <Button variant="secondary" onClick={() => void openAuthorization()}><ExternalLink className="size-4" aria-hidden />{t.oauthOpenAuthorization}</Button> : null}
          {authorization?.acceptsRedirect ? <details><summary className="cursor-pointer text-sm text-accent-fg">{t.setupRemoteFallback}</summary>
            <p className="mt-2 text-xs text-fg-muted">{t.setupRedirectHint}</p>
            <label className="mt-2 block"><span className="sr-only">{t.setupRedirectLabel}</span><input className={inputClass} value={redirect} placeholder="http://127.0.0.1:…/callback?code=…" onChange={event => setRedirect(event.target.value)} /></label>
            <Button className="mt-2" disabled={!redirect.trim()} onClick={() => void submitRedirect()}>{t.setupContinue}</Button>
          </details> : null}
        </div> : null}
        {error ? <p role="alert" className="mt-4 whitespace-pre-wrap break-words text-sm text-danger">{error}</p> : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-edge p-4">
        <Button variant="secondary" onClick={props.onClose}>{cs.modalCancel}</Button>
        {probe?.state === 'connected' ? <Button onClick={props.onClose}>{t.setupDone}</Button>
          : probe?.state === 'oauth_required' ? <Button disabled={busy} aria-busy={busy} onClick={() => void signIn()}>{t.setupSignIn}</Button>
          : <Button disabled={busy || (probe?.state === 'token_required' && !token.trim()) || (row.transport === 'streamable-http' ? !row.url.trim() : !row.command.trim())} aria-busy={busy} onClick={() => void connect()}>{t.setupConnect}</Button>}
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
