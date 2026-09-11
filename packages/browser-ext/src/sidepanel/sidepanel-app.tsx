import { useEffect, useState } from 'react';

import {
  discoverLocalGateway,
  pairGateway,
  readProfile,
  revokeAndForgetProfile,
  type BrowserGatewayProfile,
} from './auth';
import { ChatPanel } from './chat-panel';

export function SidePanelApp() {
  const [profile, setProfile] = useState<BrowserGatewayProfile>();
  const [pairingLink, setPairingLink] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [state, setState] = useState<'loading' | 'unpaired' | 'pairing' | 'online' | 'offline'>('loading');
  const [error, setError] = useState('');
  const [localPairingLink, setLocalPairingLink] = useState('');

  useEffect(() => {
    void readProfile().then(async (stored) => {
      setProfile(stored);
      setState(stored ? 'online' : 'unpaired');
      if (!stored) {
        const local = await discoverLocalGateway();
        if (local) setLocalPairingLink(local.pairingLink);
      }
    });
  }, []);

  async function connect(link = pairingLink) {
    setState('pairing');
    setError('');
    try {
      const paired = await pairGateway(link, setConfirmationCode);
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
    setState('unpaired');
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
                <p className="muted">A local xopc Gateway was found. Connecting still requires approval in the Gateway.</p>
                <button className="primary local-connect" onClick={() => void connect(localPairingLink)} disabled={state === 'pairing'}>
                  {state === 'pairing' ? 'Waiting for approval…' : 'Connect local xopc'}
                </button>
                <div className="pairing-divider">or use a pairing link</div>
              </>
            ) : <p className="muted">Create a browser pairing link in the xopc Gateway, then paste it here.</p>}
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
