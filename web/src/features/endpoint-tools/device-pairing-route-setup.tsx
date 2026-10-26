import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import {
  fetchTunnelStatus,
  patchTunnelConfig,
  provisionTunnelRegistrationKey,
  recordTunnelConsent,
  startTunnel,
  TUNNEL_CONSOLE_REGISTRATION_KEY_URL,
  tunnelApiErrorCode,
  tunnelApiRequiresAuthorization,
  tunnelRegistrationKeyRejected,
  tunnelRecoveryProofRejected,
} from '@/features/tunnel/tunnel-api';
import { cleanupOAuthSession, fetchOAuthSessionStatus, startAsyncOAuthLogin } from '@/features/settings/oauth-api';
import { closeOAuthAuthorizationWindow, openOAuthAuthorizationUrl, reserveOAuthAuthorizationWindow } from '@/features/settings/oauth-authorization-window';
import { openExternalHttpLink } from '@/lib/app-link';

type RouteSetupError = 'key-limit' | 'registration-rejected' | 'recovery-rejected' | 'failed' | null;

/** Compact presentation of the existing tunnel services for the pairing wizard. */
export function DevicePairingRouteSetup() {
  const language = useLocaleStore(s => s.language);
  const m = messages(language);
  const f = m.endpointToolsSettings.deviceAccess.flow;
  const t = m.tunnelSettings;
  const { data, error: statusError, mutate } = useSWR('tunnel-status', fetchTunnelStatus, { refreshInterval: 1500 });
  const [consent, setConsent] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'provisioning' | 'authorizing' | 'starting'>('idle');
  const [error, setError] = useState<RouteSetupError>(null);
  const [errorDetail, setErrorDetail] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (data?.state === 'connected') { setError(null); setErrorDetail(''); }
  }, [data?.state]);
  const registrationRejected = error ? error === 'registration-rejected'
    : data?.state === 'error' && tunnelRegistrationKeyRejected(new Error(data.lastError ?? ''));
  const recoveryRejected = error ? error === 'recovery-rejected'
    : data?.state === 'error' && tunnelRecoveryProofRejected(new Error(data.lastError ?? ''));
  const enable = async () => {
    if (!data) return;
    if (data.consentRequired && !consent) { setShowConsent(true); return; }
    const needsRegistration = registrationRejected || !data.registrationSecret?.configured;
    const popup = needsRegistration ? reserveOAuthAuthorizationWindow() : null;
    let sessionId: string | undefined;
    let terminal = false;
    setError(null);
    setErrorDetail('');
    try {
      if (data.consentRequired) await recordTunnelConsent();
      if (needsRegistration) {
        setPhase('provisioning');
        if (registrationRejected) await patchTunnelConfig({ registrationSecret: null });
        let authorizationRequired = false;
        try {
          await provisionTunnelRegistrationKey();
        } catch (cause) {
          if (!tunnelApiRequiresAuthorization(cause)) throw cause;
          authorizationRequired = true;
        }
        if (authorizationRequired) {
          setPhase('authorizing');
          const saved = sessionStorage.getItem('device-pairing-oauth');
          const pending = saved ? JSON.parse(saved) as { sessionId: string; expiresAt: number } : null;
          sessionId = pending && pending.expiresAt > Date.now() ? pending.sessionId : (await startAsyncOAuthLogin('xopc-tunnel')).sessionId;
          sessionStorage.setItem('device-pairing-oauth', JSON.stringify({ sessionId, expiresAt: pending && pending.expiresAt > Date.now() ? pending.expiresAt : Date.now() + 5 * 60_000 }));
          let opened = '';
          const until = Date.now() + 5 * 60_000;
          let authorized = false;
          while (alive.current && Date.now() < until) {
            const current = await fetchOAuthSessionStatus(sessionId);
            if (current.authUrl && current.authUrl !== opened) {
              opened = current.authUrl;
              if (!await openOAuthAuthorizationUrl(opened, popup)) setAuthorizationUrl(opened);
            }
            if (current.status === 'completed') { authorized = true; terminal = true; break; }
            if (current.status === 'failed' || current.status === 'cancelled') throw new Error('Authorization cancelled');
            await new Promise(r => setTimeout(r, 1000));
          }
          if (!alive.current) return;
          if (!authorized) throw new Error('Authorization expired');
          await provisionTunnelRegistrationKey();
        }
        await mutate();
      }
      if (!alive.current) return;
      setPhase('starting');
      await startTunnel(recoveryRejected ? { recoverActiveLease: true } : undefined);
      if (autoStart) await patchTunnelConfig({ autoStart: true });
      await mutate();
      terminal = true;
    } catch (cause) {
      terminal = true;
      if (alive.current) {
        setError(tunnelApiErrorCode(cause) === 'tunnel_key_limit_reached' ? 'key-limit' : tunnelRegistrationKeyRejected(cause) ? 'registration-rejected' : tunnelRecoveryProofRejected(cause) ? 'recovery-rejected' : 'failed');
        setErrorDetail(cause instanceof Error ? cause.message : '');
      }
    }
    finally {
      closeOAuthAuthorizationWindow(popup);
      if (terminal) {
        sessionStorage.removeItem('device-pairing-oauth');
        if (sessionId) void cleanupOAuthSession(sessionId).catch(() => {});
      }
      if (alive.current) { setPhase('idle'); setAuthorizationUrl(''); }
    }
  };
  if (!data && !statusError) return <div className="space-y-5"><Skeleton className="h-5 w-4/5" /><Skeleton className="h-24 w-full" /></div>;
  const preparing = phase === 'provisioning' || phase === 'starting' || data?.state === 'connecting' || data?.state === 'reconnecting';
  const failed = phase === 'idle' && !preparing && (error || statusError || data?.state === 'error');
  const failureDetail = errorDetail || (statusError instanceof Error ? statusError.message : '') || (data?.state === 'error' ? data.lastError : '');
  return <div className="flex flex-col">
    <p className="text-sm leading-relaxed text-fg-muted">{preparing ? f.preparingHint : phase === 'authorizing' ? f.authorizing : f.enableHint}</p>
    {authorizationUrl && phase === 'authorizing' ? <a href={authorizationUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center text-sm text-accent">{f.openAuthorization}</a> : null}
    {preparing ? <div className="mt-8 space-y-3" aria-label={f.preparing}><Skeleton className="h-2 w-full" /><p className="text-sm text-fg-muted">{f.preparing}</p></div> : null}
    {(showConsent || data?.consentRequired) && phase === 'idle' ? <div className="mt-6 space-y-4">
      <details open={showConsent} className="text-sm text-fg-muted"><summary className="cursor-pointer py-2">{f.details}</summary>
        <p className="mt-2">{t.consentIntro}</p><ul className="mt-3 list-disc space-y-2 pl-5">{[t.consentBullet1,t.consentBullet2,t.consentBullet3].map(line => <li key={line}>{line}</li>)}</ul>
      </details>
      <label className="flex items-start gap-3 text-sm text-fg"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 size-4 accent-accent" />{t.consentCheckbox}</label>
    </div> : null}
    {failed && error === 'key-limit' ? <div role="alert" className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-4">
      <p className="text-sm font-medium text-fg">{f.routeKeyLimitTitle}</p>
      <p className="mt-1 text-xs leading-5 text-fg-muted">{f.routeKeyLimitHint}</p>
      <Button variant="secondary" className="mt-3" onClick={() => void openExternalHttpLink(TUNNEL_CONSOLE_REGISTRATION_KEY_URL)}>
        {f.manageTunnelKeys}<ExternalLink className="size-3" />
      </Button>
    </div> : failed ? <div role="alert" className="mt-4 text-sm text-danger">
      <p>{statusError && !data ? f.readinessFailed : registrationRejected ? f.routeAuthorizationRequired : recoveryRejected ? f.routeRecoveryRequired : f.routeSetupFailed}</p>
      {failureDetail ? <details className="mt-2 text-xs text-fg-muted"><summary className="cursor-pointer py-2">{f.details}</summary><p className="break-words whitespace-pre-wrap">{failureDetail}</p></details> : null}
    </div> : null}
    <label className="my-5 flex items-center gap-3 text-sm text-fg-muted"><input type="checkbox" checked={autoStart} disabled={phase !== 'idle'} onChange={e => setAutoStart(e.target.checked)} className="size-4 accent-accent" />{f.autoStart}</label>
    {statusError && !data ? <Button className="w-full" variant="primary" onClick={() => void mutate().catch(() => {})}>{f.retry}</Button> :
      <Button className="w-full" variant="primary" disabled={!data || phase !== 'idle' || preparing || (showConsent && !consent)} onClick={() => void enable()}>
        {phase === 'authorizing' ? f.authorizing : preparing ? f.preparing : registrationRejected ? f.authorize : recoveryRejected ? f.recoverRoute : failed ? f.retry : f.enable}
      </Button>}
  </div>;
}
