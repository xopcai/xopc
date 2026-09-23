import { useCallback, useEffect, useRef, useState } from 'react';

import {
  saveExtensionLocalePreference,
  t,
  type ExtensionLocale,
} from '../i18n';
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
import {
  CheckIcon,
  GlobeIcon,
  SettingsIcon,
  SparkleIcon,
  SunIcon,
} from './icons';
import {
  saveSidePanelThemePreference,
  type SidePanelTheme,
} from './theme';

async function reconnectBrowserBridge(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'browser/reconnect' }).catch(() => undefined);
}

function pairingErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === 'Gateway site permission was not granted') {
    return t('errorGatewayPermissionHelp');
  }
  if (message === 'PAIRING_EXPIRED' || message === 'Pairing expired' || message === 'Pairing invitation has expired') {
    return t('errorInvitationExpiredHelp');
  }
  if (message === 'PAIRING_DEVICE_MISMATCH') {
    return t('errorPairingDeviceMismatch');
  }
  if (message === 'No Gateway route could be reached') {
    return t('errorNoReachableGatewayRouteHelp');
  }
  if (message.startsWith('PAIRING_ROUTE_PERMISSION_REQUIRED:')) {
    return t('errorNextRoutePermission');
  }
  return message;
}

interface SidePanelAppProps {
  initialLocale: ExtensionLocale;
  initialTheme: SidePanelTheme;
}

export function SidePanelApp({ initialLocale, initialTheme }: SidePanelAppProps) {
  const [profile, setProfile] = useState<BrowserGatewayProfile>();
  const [invitation, setInvitation] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [state, setState] = useState<'loading' | 'unpaired' | 'pairing' | 'online' | 'offline'>('loading');
  const [error, setError] = useState('');
  const [localInvitation, setLocalInvitation] = useState('');
  const [nextOrigin, setNextOrigin] = useState<string>();
  const [locale, setLocale] = useState(initialLocale);
  const [theme, setTheme] = useState(initialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const initializationStarted = useRef(false);
  const pairingStarted = useRef(false);
  const settingsMenu = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    const onProfileChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes['xopc.browser.profile']) return;
      const next = changes['xopc.browser.profile'].newValue as BrowserGatewayProfile | undefined;
      if (next?.gatewayId && next.gatewayUrl && next.refreshToken) {
        setProfile(next);
        setError('');
        setState('online');
      } else {
        setProfile(undefined);
        setState('unpaired');
      }
    };
    chrome.storage.onChanged.addListener(onProfileChanged);
    return () => chrome.storage.onChanged.removeListener(onProfileChanged);
  }, []);

  useEffect(() => {
    function closeSettings(event: MouseEvent) {
      const target = event.target as Node;
      if (!settingsMenu.current?.contains(target) && !settingsTrigger.current?.contains(target)) {
        setSettingsOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen(false);
    }
    document.addEventListener('mousedown', closeSettings);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeSettings);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function changeTheme(nextTheme: SidePanelTheme) {
    setTheme(nextTheme);
    await saveSidePanelThemePreference(nextTheme);
  }

  async function changeLocale(nextLocale: ExtensionLocale) {
    await saveExtensionLocalePreference(nextLocale);
    setLocale(nextLocale);
  }

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
      if (!local) throw new Error(t('errorNoLocalGateway'));
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
          {state === 'pairing' ? t('statusPairing') : state === 'loading' ? t('statusStarting') : t('statusSetupRequired')}
        </div> : null}
        <div className="header-actions">
          <button
            ref={settingsTrigger}
            className="header-icon-button"
            onClick={() => setSettingsOpen((open) => !open)}
            title={t('settings')}
            aria-label={t('settings')}
            aria-expanded={settingsOpen}
          >
            <SettingsIcon />
          </button>
          {settingsOpen ? (
            <div ref={settingsMenu} className="settings-menu">
              <div className="settings-menu-title">{t('settings')}</div>
              <div className="settings-group">
                <div className="settings-label"><SunIcon />{t('appearance')}</div>
                <div className="settings-options">
                  <button className={theme === 'light' ? 'active' : ''} onClick={() => void changeTheme('light')}>
                    {t('themeLight')}{theme === 'light' ? <CheckIcon /> : null}
                  </button>
                  <button className={theme === 'dark' ? 'active' : ''} onClick={() => void changeTheme('dark')}>
                    {t('themeDark')}{theme === 'dark' ? <CheckIcon /> : null}
                  </button>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-label"><GlobeIcon />{t('language')}</div>
                <div className="settings-options">
                  <button className={locale === 'zh-CN' ? 'active' : ''} onClick={() => void changeLocale('zh-CN')}>
                    {t('languageChinese')}{locale === 'zh-CN' ? <CheckIcon /> : null}
                  </button>
                  <button className={locale === 'en' ? 'active' : ''} onClick={() => void changeLocale('en')}>
                    {t('languageEnglish')}{locale === 'en' ? <CheckIcon /> : null}
                  </button>
                </div>
              </div>
              {state === 'online' && profile ? (
                <button className="settings-disconnect" onClick={() => void disconnect()} title={t('disconnectGateway', profile.gatewayName)}>
                  {t('disconnect')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      {state !== 'online' ? <section className="center">
        {state === 'loading' ? <div className="muted">{t('loading')}</div> : null}
        {(state === 'unpaired' || state === 'pairing') ? (
          <div className="card">
            <h1>{t('connectToXopc')}</h1>
            {localInvitation ? (
              <>
                <p className="muted">{t('localGatewayFound')}</p>
                <button className="primary local-connect" onClick={() => void connect(localInvitation)} disabled={state === 'pairing'}>
                  {state === 'pairing' ? t('connecting') : t('retryLocalConnection')}
                </button>
                <div className="pairing-divider">{t('pairingLinkDivider')}</div>
              </>
            ) : (
              <>
                <p className="muted">{t('connectGatewayHelp')}</p>
                <button className="primary local-connect" onClick={() => void connectLocalGateway()} disabled={state === 'pairing'}>
                  {state === 'pairing' ? t('connecting') : t('connectLocalGateway')}
                </button>
                <div className="pairing-divider">{t('pairingLinkDivider')}</div>
              </>
            )}
            <label className="field">
              {t('pairingLink')}
              <textarea rows={4} value={invitation} onChange={(event) => setInvitation(event.target.value)} disabled={state === 'pairing'} />
            </label>
            {confirmationCode ? (
              <><p className="muted">{t('confirmGatewayCode')}</p><div className="approval-code">{confirmationCode}</div></>
            ) : null}
            {error ? <div className="error-text">{error}</div> : null}
            <div className="actions">
              <button className="primary" onClick={() => void connect(invitation, nextOrigin)} disabled={!invitation.trim() || state === 'pairing'}>
                {state === 'pairing'
                  ? t('waitingForApproval')
                  : nextOrigin ? t('allowGatewayAndContinue', new URL(nextOrigin).host) : t('connect')}
              </button>
              {invitation ? <button onClick={() => void cancelPairing()} disabled={state === 'pairing'}>{t('cancelPairing')}</button> : null}
            </div>
          </div>
        ) : null}
      </section> : <ChatPanel key={`${profile!.gatewayId}:${profile!.gatewayUrl}`} gatewayId={profile!.gatewayId} />}
    </main>
  );
}
