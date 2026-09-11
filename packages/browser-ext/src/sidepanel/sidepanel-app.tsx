import { useEffect, useRef, useState } from 'react';

import {
  discoverLocalGateway,
  pairGateway,
  readProfile,
  revokeAndForgetProfile,
  setAutoConnectEnabled,
  type BrowserGatewayProfile,
} from './auth';
import { ChatPanel } from './chat-panel';
import { watchSidePanelTheme } from './theme';

async function reconnectBrowserBridge(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'browser/reconnect' }).catch(() => undefined);
}

export function SidePanelApp() {
  const [profile, setProfile] = useState<BrowserGatewayProfile>();
  const [pairingLink, setPairingLink] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [state, setState] = useState<'loading' | 'unpaired' | 'pairing' | 'online' | 'offline'>('loading');
  const [error, setError] = useState('');
  const [localPairingLink, setLocalPairingLink] = useState('');
  const initializationStarted = useRef(false);

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

      const local = await discoverLocalGateway();
      if (!local) {
        setState('unpaired');
        return;
      }

      setLocalPairingLink(local.pairingLink);
      setState('pairing');
      try {
        const paired = await pairGateway(local.pairingLink, setConfirmationCode);
        await reconnectBrowserBridge();
        setProfile(paired);
        setState('online');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setState('unpaired');
      }
    })();
  }, []);

  useEffect(() => watchSidePanelTheme(profile?.gatewayUrl), [profile?.gatewayUrl]);

  async function connect(link = pairingLink) {
    setState('pairing');
    setError('');
    try {
      const paired = await pairGateway(link, setConfirmationCode);
      await setAutoConnectEnabled(true);
      await reconnectBrowserBridge();
      setProfile(paired);
      setState('online');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('unpaired');
    }
  }

  async function disconnect() {
    await revokeAndForgetProfile();
    setProfile(undefined);
    setLocalPairingLink('');
    setState('unpaired');
  }

  async function connectLocalGateway() {
    setState('pairing');
    setError('');
    try {
      const local = await discoverLocalGateway({ force: true });
      if (!local) throw new Error('No local xopc Gateway was found');
      setLocalPairingLink(local.pairingLink);
      await connect(local.pairingLink);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('unpaired');
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">xopc</div>
        <div className="status">
          <span className={`status-dot ${state === 'online' ? 'online' : error ? 'error' : ''}`} />
          {state === 'online' ? 'Connected' : state === 'pairing' ? 'Pairing' : 'Not connected'}
        </div>
      </header>
      {state !== 'online' ? <section className="center">
        {state === 'loading' ? <div className="muted">Loading…</div> : null}
        {(state === 'unpaired' || state === 'pairing') ? (
          <div className="card">
            <h1>Connect to xopc</h1>
            {localPairingLink ? (
              <>
                <p className="muted">A local xopc Gateway was found. xopc connects automatically on this computer.</p>
                <button className="primary local-connect" onClick={() => void connect(localPairingLink)} disabled={state === 'pairing'}>
                  {state === 'pairing' ? 'Connecting…' : 'Retry local connection'}
                </button>
                <div className="pairing-divider">or use a pairing link</div>
              </>
            ) : (
              <>
                <p className="muted">Connect to a local Gateway, or paste a pairing link for another Gateway.</p>
                <button className="primary local-connect" onClick={() => void connectLocalGateway()} disabled={state === 'pairing'}>
                  {state === 'pairing' ? 'Connecting…' : 'Connect local Gateway'}
                </button>
                <div className="pairing-divider">or use a pairing link</div>
              </>
            )}
            <label className="field">
              Pairing link
              <textarea rows={4} value={pairingLink} onChange={(event) => setPairingLink(event.target.value)} disabled={state === 'pairing'} />
            </label>
            {confirmationCode ? (
              <><p className="muted">Confirm this code in the Gateway:</p><div className="approval-code">{confirmationCode}</div></>
            ) : null}
            {error ? <div className="error-text">{error}</div> : null}
            <div className="actions">
              <button className="primary" onClick={() => void connect()} disabled={!pairingLink.trim() || state === 'pairing'}>
                {state === 'pairing' ? 'Waiting for approval…' : 'Connect'}
              </button>
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
