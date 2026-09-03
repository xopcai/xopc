import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { fetchTunnelStatus, recordTunnelConsent, provisionTunnelRegistrationKey, startTunnel, patchTunnelConfig } from '@/features/tunnel/tunnel-api';
import { cleanupOAuthSession, fetchOAuthSessionStatus, startAsyncOAuthLogin } from '@/features/settings/oauth-api';
import { closeOAuthAuthorizationWindow, openOAuthAuthorizationUrl, reserveOAuthAuthorizationWindow } from '@/features/settings/oauth-authorization-window';

/** Compact presentation of the existing tunnel services for the pairing wizard. */
export function MobilePairingRouteSetup() {
  const language = useLocaleStore(s => s.language);
  const m = messages(language);
  const f = m.endpointToolsSettings.mobileAccess.flow;
  const t = m.tunnelSettings;
  const { data, error: statusError, mutate } = useSWR('tunnel-status', fetchTunnelStatus, { refreshInterval: 1500 });
  const [consent, setConsent] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'authorizing' | 'starting'>('idle');
  const [error, setError] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const enable = async () => {
    if (!data) return;
    if (data.consentRequired && !consent) { setShowConsent(true); return; }
    const popup = !data.registrationSecret?.configured ? reserveOAuthAuthorizationWindow() : null;
    let sessionId: string | undefined;
    let terminal = false;
    setError(false);
    try {
      if (data.consentRequired) await recordTunnelConsent();
      if (!data.registrationSecret?.configured) {
        setPhase('authorizing');
        const saved = sessionStorage.getItem('mobile-pairing-oauth');
        const pending = saved ? JSON.parse(saved) as { sessionId: string; expiresAt: number } : null;
        sessionId = pending && pending.expiresAt > Date.now() ? pending.sessionId : (await startAsyncOAuthLogin('xopc-tunnel')).sessionId;
        sessionStorage.setItem('mobile-pairing-oauth', JSON.stringify({ sessionId, expiresAt: pending && pending.expiresAt > Date.now() ? pending.expiresAt : Date.now() + 5 * 60_000 }));
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
      if (!alive.current) return;
      setPhase('starting');
      await startTunnel();
      if (autoStart) await patchTunnelConfig({ autoStart: true });
      await mutate();
      terminal = true;
    } catch { terminal = true; if (alive.current) setError(true); }
    finally {
      closeOAuthAuthorizationWindow(popup);
      if (terminal) {
        sessionStorage.removeItem('mobile-pairing-oauth');
        if (sessionId) void cleanupOAuthSession(sessionId).catch(() => {});
      }
      if (alive.current) { setPhase('idle'); setAuthorizationUrl(''); }
    }
  };
  if (!data && !statusError) return <div className="space-y-5"><Skeleton className="h-5 w-4/5" /><Skeleton className="h-24 w-full" /></div>;
  const preparing = phase === 'starting' || data?.state === 'connecting' || data?.state === 'reconnecting';
  return <div className="flex min-h-full flex-col">
    <p className="text-sm leading-relaxed text-fg-muted">{preparing ? f.preparingHint : phase === 'authorizing' ? f.authorizing : f.enableHint}</p>
    {authorizationUrl && phase === 'authorizing' ? <a href={authorizationUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center text-sm text-accent">{f.openAuthorization}</a> : null}
    {preparing ? <div className="mt-8 space-y-3" aria-label={f.preparing}><Skeleton className="h-2 w-full" /><p className="text-sm text-fg-muted">{f.preparing}</p></div> : null}
    {(showConsent || data?.consentRequired) && phase === 'idle' ? <div className="mt-6 space-y-4">
      <details open={showConsent} className="text-sm text-fg-muted"><summary className="cursor-pointer py-2">{f.details}</summary>
        <p className="mt-2">{t.consentIntro}</p><ul className="mt-3 list-disc space-y-2 pl-5">{[t.consentBullet1,t.consentBullet2,t.consentBullet3].map(line => <li key={line}>{line}</li>)}</ul>
      </details>
      <label className="flex items-start gap-3 text-sm text-fg"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 size-4 accent-accent" />{t.consentCheckbox}</label>
    </div> : null}
    {error || statusError || data?.state === 'error' ? <p role="alert" className="mt-4 text-sm text-danger">{f.failed}</p> : null}
    <div className="flex-1" />
    <label className="my-5 flex items-center gap-3 text-sm text-fg-muted"><input type="checkbox" checked={autoStart} disabled={phase !== 'idle'} onChange={e => setAutoStart(e.target.checked)} className="size-4 accent-accent" />{f.autoStart}</label>
    <Button className="w-full" variant="primary" disabled={!data || phase !== 'idle' || preparing || (showConsent && !consent)} onClick={() => void enable()}>
      {phase === 'authorizing' ? f.authorizing : preparing ? f.preparing : error ? f.retry : f.enable}
    </Button>
    {statusError && !data ? <Button variant="ghost" onClick={() => void mutate()}>{f.retry}</Button> : null}
  </div>;
}
