import { useEffect, useState } from 'react';
import type { BrowserRecording } from '@xopcai/browser-control-contract';

import { t } from '../i18n';
import { gatewayFetch } from './auth';
import { CheckIcon, GlobeIcon, PageIcon, StopIcon } from './icons';

type SavedAutomation = { id: string; revision: number; verified: boolean; definition: { name: string; inputs: Record<string, { type: string; default?: string | number | boolean; description?: string }> } };
type Run = { id: string; status: string; error?: string; result?: unknown; businessOutcome?: string };

export function recordingErrorMessage(cause: unknown): string {
  const message = (cause instanceof Error ? cause.message : String(cause)).replace(/^(?:Error:\s*)+/, '');
  if (message === 'RECORDING_PAGE_UNAVAILABLE') return t('recordingChooseWebsite');
  return message;
}

export function RecordingPanel() {
  const [session, setSession] = useState<Omit<BrowserRecording, 'events'>>();
  const [pages, setPages] = useState<chrome.tabs.Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<number>();
  const [pagesLoading, setPagesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [automation, setAutomation] = useState<SavedAutomation>();
  const [inputs, setInputs] = useState<Record<string, string | number | boolean>>({});
  const [run, setRun] = useState<Run>();
  const api = async (path: string, init?: RequestInit) => {
    const response = await gatewayFetch(path, init);
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || t('recordingRequestFailed'));
    return data;
  };
  const command = async (operation: string, tabId?: number) => {
    const response = await chrome.runtime.sendMessage({ type: 'browser/recording-command', operation, ...(tabId !== undefined ? { tabId } : {}) });
    if (!response.ok) throw new Error(response.error);
    return response.value;
  };
  useEffect(() => {
    let disposed = false;
    const refresh = async (followActive = false) => {
      try {
        const tabs = (await chrome.tabs.query({ currentWindow: true })).filter((tab) => tab.id !== undefined && /^https?:\/\//.test(tab.url ?? ''));
        if (disposed) return;
        setPages(tabs);
        setSelectedTab((current) => followActive && tabs.find((tab) => tab.active)?.id
          || tabs.find((tab) => tab.id === current)?.id || tabs.find((tab) => tab.active)?.id || (tabs.length === 1 ? tabs[0]!.id : undefined));
      } catch (cause) { if (!disposed) setError(recordingErrorMessage(cause)); }
      finally { if (!disposed) setPagesLoading(false); }
    };
    const activated = () => { void refresh(true); };
    const changed = () => { void refresh(); };
    void refresh(true);
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(changed);
    chrome.tabs.onRemoved.addListener(changed);
    chrome.tabs.onCreated.addListener(changed);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(changed);
      chrome.tabs.onRemoved.removeListener(changed); chrome.tabs.onCreated.removeListener(changed);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    const refresh = () => void command('status').then((sessions: Omit<BrowserRecording, 'events'>[]) => {
      if (!disposed) setSession(sessions.find((item) => ['recording', 'paused'].includes(item.state)) ?? sessions.at(-1));
    }).catch((cause) => { if (!disposed) setError(recordingErrorMessage(cause)); });
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!session?.automationId) { setAutomation(undefined); return; }
    let disposed = false;
    void api(`/api/browser/automations/${encodeURIComponent(session.automationId)}`).then((data) => {
      if (disposed) return;
      const saved: SavedAutomation = data.automation;
      setAutomation(saved);
      setInputs(Object.fromEntries(Object.entries(saved.definition.inputs).map(([key, spec]) => [key, spec.default ?? ''])));
    }).catch((cause) => { if (!disposed) setError(recordingErrorMessage(cause)); });
    return () => { disposed = true; };
  }, [session?.automationId]);
  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void api(`/api/browser/automation-runs/${run.id}`).then((data) => { if (!disposed) setRun(data.run); }).catch((cause) => { if (!disposed) setError(recordingErrorMessage(cause)); });
    }, 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [run]);
  const runSaved = async () => {
    if (!automation) return;
    setBusy(true); setError('');
    try {
      const data = await api(`/api/browser/automations/${automation.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, revision: automation.revision, clientRequestId: crypto.randomUUID() }) });
      setRun(data.run);
    } catch (cause) { setError(recordingErrorMessage(cause)); } finally { setBusy(false); }
  };
  const act = async (operation: string) => {
    setBusy(true); setError('');
    try {
      if (operation === 'start') {
        if (selectedTab === undefined) return;
        await chrome.tabs.update(selectedTab, { active: true });
        setRun(undefined);
      }
      setSession(await command(operation, operation === 'start' ? selectedTab : undefined));
    } catch (cause) { setError(recordingErrorMessage(cause)); } finally { setBusy(false); }
  };
  const active = !!session && ['recording', 'paused'].includes(session.state);
  const saved = !!session?.automationId;
  const syncing = session?.state === 'stopped' && !saved;
  const page = pages.find((tab) => tab.id === (active || syncing ? session!.tabId : selectedTab));
  const status = active ? session!.state === 'paused' ? 'recordingPaused' : 'recordingActive'
    : saved ? 'recordingSavedShort' : session?.state === 'stopped' ? 'recordingSaving' : session?.state === 'interrupted' ? 'recordingInterrupted' : 'recordingReady';
  const runStatus = run?.businessOutcome === 'unknown' ? t('recordingUnknown')
    : run?.status === 'succeeded' ? t('recordingCompleted') : run?.status === 'cancelled' ? t('recordingStopped')
    : run?.status === 'failed' ? recordingErrorMessage(run.error || t('recordingRequestFailed')) : t('recordingRunning');
  return <section className="recording-panel" data-state={active ? session!.state : syncing ? 'syncing' : saved ? 'saved' : 'ready'} aria-label={t('recordingTitle')} aria-busy={busy}>
    <header className="recording-heading">
      <span className="recording-icon">{saved ? <CheckIcon /> : <PageIcon />}</span>
      <div className="recording-heading-text"><strong>{saved && automation ? automation.definition.name : t('recordingTitle')}</strong><p>{active ? t('recordingActiveHelp') : saved ? t('recordingSaved') : t('recordingDescription')}</p></div>
      {(active || saved || session?.state === 'stopped' || session?.state === 'interrupted' || selectedTab !== undefined) && <span className={`recording-status ${active && session!.state === 'recording' ? 'is-recording' : saved ? 'is-saved' : ''}`} role="status"><i />{t(status)}</span>}
    </header>
    {!active && !syncing && (!saved || selectedTab === undefined) && (pagesLoading ? <div className="recording-skeleton" /> : pages.length ? <label className="recording-target-label">{t('recordingTarget')}
      <select className="recording-page-select" value={selectedTab ?? ''} disabled={busy} onChange={(event) => { setSelectedTab(Number(event.target.value)); setError(''); }}>
        <option value="" disabled>{t('recordingChoosePage')}</option>
        {pages.map((tab) => <option key={tab.id} value={tab.id}>{tab.title || new URL(tab.url!).hostname}</option>)}
      </select></label> : <p className="recording-hint">{t('recordingChooseWebsite')}</p>)}
    {page && <div className="recording-page"><GlobeIcon /><span>{new URL(page.url!).hostname}</span>{active && <strong>{page.title}</strong>}</div>}
    {syncing && <p className="recording-sync" role="status"><span className="recording-spinner" aria-hidden="true" /><span>{t('recordingSyncing')}</span></p>}
    {session?.state === 'interrupted' && <p className="recording-hint">{t('recordingInterruptedHelp')}</p>}
    {automation && Object.keys(automation.definition.inputs).length > 0 && <details className="recording-parameters">
      <summary>{t('recordingParameters')}</summary>
      {Object.entries(automation.definition.inputs).map(([key, spec]) => <label className={`recording-input ${spec.type === 'boolean' ? 'is-checkbox' : ''}`} key={key}>{spec.description || key}
        <input type={spec.type === 'boolean' ? 'checkbox' : spec.type === 'number' ? 'number' : 'text'}
          checked={spec.type === 'boolean' ? !!inputs[key] : undefined} value={spec.type === 'boolean' ? undefined : String(inputs[key] ?? '')}
          onChange={(event) => setInputs((current) => ({ ...current, [key]: spec.type === 'boolean' ? event.target.checked : spec.type === 'number' ? Number(event.target.value) : event.target.value }))} />
      </label>)}
    </details>}
    {!syncing && <div className="recording-actions">
      {active ? <>
        <button className="recording-button" disabled={busy} onClick={() => void act(session!.state === 'paused' ? 'resume' : 'pause')}>{t(session!.state === 'paused' ? 'recordingResume' : 'recordingPause')}</button>
        <button className="recording-button is-primary" disabled={busy} onClick={() => void act('finish')}>{busy ? <span className="recording-spinner" aria-hidden="true" /> : <StopIcon />}{t('recordingFinish')}</button>
      </> : <>
        {automation && <button className="recording-button is-primary" disabled={busy || !!run && ['queued', 'running'].includes(run.status)} onClick={() => void runSaved()}>{t('recordingRun')}</button>}
        <button className={`recording-button ${saved ? '' : 'is-primary'}`} disabled={busy || pagesLoading || selectedTab === undefined} onClick={() => void act('start')}>{busy ? <span className="recording-spinner" aria-hidden="true" /> : <span className="recording-button-dot" />}{t(saved ? 'recordingNew' : 'recordingStart')}</button>
      </>}
    </div>}
    {run && <p className="recording-run-status" role="status">{runStatus}</p>}
    {run?.status === 'succeeded' && <pre className="recording-result">{typeof run.result === 'object' && run.result !== null ? Object.entries(run.result).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n') : String(run.result ?? '')}</pre>}
    {(error || session?.error) && <p className="recording-error" role="alert">{recordingErrorMessage(error || session!.error)}</p>}
  </section>;
}
