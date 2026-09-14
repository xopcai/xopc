import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelPendingBrowserPairing,
  discoverLocalGateway,
  pairGateway,
  readPendingBrowserPairing,
  readProfile,
  revokeAndForgetProfile,
  setAutoConnectEnabled,
  type BrowserGatewayProfile,
} from './auth';
import { ChatPanel } from './chat-panel';
import { SparkleIcon } from './icons';
import { watchSidePanelTheme } from './theme';

async function reconnectBrowserBridge(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'browser/reconnect' }).catch(() => undefined);
}

function pairingErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === 'Gateway site permission was not granted') {
    return 'Chrome needs access to the Gateway address. Select Connect again and allow the site permission.';
  }
  if (message === 'PAIRING_EXPIRED' || message === 'Pairing expired' || message === 'Pairing invitation has expired') {
    return 'This invitation expired. Create and copy a new invitation from Device access.';
  }
  if (message === 'PAIRING_DEVICE_MISMATCH') {
    return 'This invitation was created for a phone. Create a browser invitation instead.';
  }
  if (message === 'No Gateway route could be reached') {
    return 'None of the Gateway addresses responded. Check that the Gateway is online and its secure connection is active.';
  }
  if (message.startsWith('PAIRING_ROUTE_PERMISSION_REQUIRED:')) {
    return 'The current Gateway address did not respond. Select Continue to allow the next address listed in the invitation.';
  }
  return message;
}

export function SidePanelApp() {
  const [profile, setProfile] = useState<BrowserGatewayProfile>();
  const [invitation, setInvitation] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [state, setState] = useState<'loading' | 'unpaired' | 'pairing' | 'online' | 'offline'>('loading');
  const [error, setError] = useState('');
  const [localInvitation, setLocalInvitation] = useState('');
  const [nextOrigin, setNextOrigin] = useState<string>();
  const initializationStarted = useRef(false);
  const pairingStarted = useRef(false);

  const connect = useCallback(async (value: string, origin?: string) => {
    if (pairingStarted.current) return;
    pairingStarted.current = true;
    setState('pairing');
    setError('');
    setConfirmationCode('');
    setInvitation(value);
    try {
      const paired = await pairGateway(value, setConfirmationCode, origin);
      await setAutoConnectEnabled(true);
      await reconnectBrowserBridge();
      setProfile(paired);
      setState('online');
    } catch (cause) {
      setError(pairingErrorMessage(cause));
      setNextOrigin((await readPendingBrowserPairing())?.nextOrigin);
      setState('unpaired');
    } finally {
      pairingStarted.current = false;
    }
  }, []);

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    void (async () => {
      const stored = await readProfile();
      if (stored) {
        await reconnectBrowserBridge();
        setProfile(stored);
        setState('online');
        return;
      }

      const pending = await readPendingBrowserPairing();
      if (pending) {
        setInvitation(pending.invitation);
        setNextOrigin(pending.nextOrigin);
        if (!pending.nextOrigin) await connect(pending.invitation);
        else setState('unpaired');
        return;
      }

      const local = await discoverLocalGateway();
      if (!local) {
        setState('unpaired');
        return;
      }

      setLocalInvitation(local.invitation);
      await connect(local.invitation);
    })();
  }, [connect]);

  useEffect(() => watchSidePanelTheme(profile?.gatewayUrl), [profile?.gatewayUrl]);

  async function disconnect() {
    await revokeAndForgetProfile();
    setProfile(undefined);
    setLocalInvitation('');
    setState('unpaired');
  }

  async function connectLocalGateway() {
    setState('pairing');
    setError('');
    try {
      const local = await discoverLocalGateway({ force: true });
      if (!local) throw new Error('No local xopc Gateway was found');
      setLocalInvitation(local.invitation);
      await connect(local.invitation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('unpaired');
    }
  }

  async function cancelPairing() {
    setState('pairing');
    setError('');
    try {
      await cancelPendingBrowserPairing();
      setInvitation('');
      setNextOrigin(undefined);
      setConfirmationCode('');
      setState('unpaired');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('unpaired');
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div className="brand"><span className="brand-mark"><SparkleIcon /></span><span>xopc</span></div>
        {state !== 'online' ? <div className="status">
          <span className={`status-dot ${error ? 'error' : ''}`} />
          {state === 'pairing' ? 'Pairing' : state === 'loading' ? 'Starting' : 'Setup required'}
        </div> : null}
      </header>
      {state !== 'online' ? <section className="center">
        {state === 'loading' ? <div className="muted">Loading…</div> : null}
        {(state === 'unpaired' || state === 'pairing') ? (
          <div className="card">
            <h1>Connect a Gateway</h1>
            {localInvitation ? (
              <>
                <p className="muted">A local xopc Gateway was found. xopc connects automatically on this computer.</p>
                <button className="primary local-connect" onClick={() => void connect(localInvitation)} disabled={state === 'pairing'}>
                  {state === 'pairing' ? 'Connecting…' : 'Retry local connection'}
                </button>
                <div className="pairing-divider">or paste an invitation</div>
              </>
            ) : (
              <>
                <p className="muted">Connect locally, or paste the one-time invitation copied from Device access.</p>
                <button className="primary local-connect" onClick={() => void connectLocalGateway()} disabled={state === 'pairing'}>
                  {state === 'pairing' ? 'Connecting…' : 'Connect local Gateway'}
                </button>
                <div className="pairing-divider">or paste an invitation</div>
              </>
            )}
            <label className="field">
              One-time invitation
              <textarea rows={4} value={invitation} onChange={(event) => setInvitation(event.target.value)} disabled={state === 'pairing'} />
            </label>
            {confirmationCode ? (
              <><p className="muted">Confirm this code in the Gateway:</p><div className="approval-code">{confirmationCode}</div></>
            ) : null}
            {error ? <div className="error-text">{error}</div> : null}
            <div className="actions">
              <button className="primary" onClick={() => void connect(invitation, nextOrigin)} disabled={!invitation.trim() || state === 'pairing'}>
                {state === 'pairing' ? 'Waiting for approval…' : nextOrigin ? `Allow ${new URL(nextOrigin).host} and continue` : 'Connect'}
              </button>
              {invitation ? <button onClick={() => void cancelPairing()} disabled={state === 'pairing'}>Cancel pairing</button> : null}
            </div>
          </div>
        ) : null}
      </section> : <ChatPanel />}
      {state === 'online' && profile ? (
        <button className="disconnect-link" onClick={disconnect} title={`Disconnect ${profile.gatewayName}`}>Disconnect</button>
      ) : null}
    </main>
  );
}
