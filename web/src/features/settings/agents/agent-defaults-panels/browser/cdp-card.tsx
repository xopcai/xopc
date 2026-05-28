import { LoaderCircle, Play, Plug, Square, Webhook } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AgentDefaultsField } from '../../agent-defaults-field';
import { inputClassName } from '../../defaults-field-styles';

import { ActionResultBox, BackendModeCard } from './backend-mode-card';
import type { BrowserMessages, LaunchedCdpInstance } from './types';

type ActionStatus = 'idle' | 'pending' | 'ok' | 'error';

export function CdpCard({
  m,
  cdpUrl,
  onCdpUrlChange,
  launch,
  stop,
  listInstances,
  ping,
}: {
  m: BrowserMessages;
  cdpUrl: string;
  onCdpUrlChange: (next: string) => void;
  launch: (executablePath?: string) => Promise<LaunchedCdpInstance>;
  stop: (port: number) => Promise<void>;
  listInstances: () => Promise<LaunchedCdpInstance[]>;
  ping: (url: string) => Promise<{ reachable: boolean; browser?: string | null; error?: string }>;
}) {
  const [instances, setInstances] = useState<LaunchedCdpInstance[]>([]);
  const [launchStatus, setLaunchStatus] = useState<ActionStatus>('idle');
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<ActionStatus>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [executablePath, setExecutablePath] = useState('');

  const refreshInstances = useCallback(async () => {
    try {
      const list = await listInstances();
      setInstances(list);
    } catch {
      // silent — not blocking
    }
  }, [listInstances]);

  useEffect(() => {
    void refreshInstances();
    const id = setInterval(() => void refreshInstances(), 8000);
    return () => clearInterval(id);
  }, [refreshInstances]);

  const onLaunch = useCallback(async () => {
    if (launchStatus === 'pending') return;
    setLaunchStatus('pending');
    setLaunchMessage(null);
    try {
      const result = await launch(executablePath.trim() || undefined);
      setLaunchStatus('ok');
      setLaunchMessage(m.browserCdpLaunchedAtPort.replace('{{port}}', String(result.port)));
      onCdpUrlChange(result.wsEndpoint);
      await refreshInstances();
    } catch (e) {
      setLaunchStatus('error');
      setLaunchMessage(e instanceof Error ? e.message : String(e));
    }
  }, [executablePath, launch, launchStatus, m.browserCdpLaunchedAtPort, onCdpUrlChange, refreshInstances]);

  const onStop = useCallback(
    async (port: number) => {
      await stop(port);
      await refreshInstances();
    },
    [refreshInstances, stop],
  );

  const onTest = useCallback(async () => {
    if (!cdpUrl.trim()) return;
    setTestStatus('pending');
    setTestMessage(null);
    try {
      const result = await ping(cdpUrl.trim());
      if (result.reachable) {
        setTestStatus('ok');
        setTestMessage(m.browserCdpReachable.replace('{{browser}}', result.browser ?? '—'));
      } else {
        setTestStatus('error');
        setTestMessage(m.browserCdpUnreachable.replace('{{error}}', result.error ?? '—'));
      }
    } catch (e) {
      setTestStatus('error');
      setTestMessage(m.browserCdpUnreachable.replace('{{error}}', e instanceof Error ? e.message : String(e)));
    }
  }, [cdpUrl, m.browserCdpReachable, m.browserCdpUnreachable, ping]);

  return (
    <div className="flex flex-col gap-4">
      <BackendModeCard
        icon={Play}
        title={m.browserCdpLaunchLocal}
        description={m.browserCdpLaunchLocalDesc}
        m={m}
        primaryAction={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
            disabled={launchStatus === 'pending'}
            onClick={() => void onLaunch()}
          >
            {launchStatus === 'pending' ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {launchStatus === 'pending' ? m.browserCdpLaunching : m.browserCdpLaunchLocal}
          </button>
        }
        advanced={
          <AgentDefaultsField label={m.browserCdpChromePath} description={m.browserCdpChromePathDesc}>
            <input
              type="text"
              className={inputClassName()}
              value={executablePath}
              placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
              onChange={(e) => setExecutablePath(e.target.value)}
              autoComplete="off"
            />
          </AgentDefaultsField>
        }
      >
        {launchMessage ? (
          <ActionResultBox kind={launchStatus === 'error' ? 'error' : 'success'} message={launchMessage} />
        ) : null}

        {instances.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-base p-3 text-xs">
            {instances.map((it) => (
              <div key={it.port} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-fg">port {it.port} · pid {it.pid}</span>
                  <span className="truncate text-fg-subtle">{it.wsEndpoint}</span>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-panel px-2 py-1 text-xs font-medium text-fg hover:bg-surface-raised"
                  onClick={() => void onStop(it.port)}
                >
                  <Square className="size-3" />
                  {m.browserCdpStopLocal}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </BackendModeCard>

      <BackendModeCard
        icon={Webhook}
        title={m.label.browserCdpUrl}
        description={m.desc.browserCdpUrl}
        m={m}
        primaryAction={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!cdpUrl.trim() || testStatus === 'pending'}
            onClick={() => void onTest()}
          >
            {testStatus === 'pending' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
            {testStatus === 'pending' ? m.browserCdpTesting : m.browserCdpTestConnection}
          </button>
        }
      >
        <input
          type="text"
          className={inputClassName()}
          value={cdpUrl}
          placeholder="ws://127.0.0.1:9222"
          onChange={(e) => onCdpUrlChange(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[11px] text-fg-subtle">{m.browserCdpLoopbackOnly}</p>
        {testMessage ? (
          <ActionResultBox kind={testStatus === 'error' ? 'error' : 'success'} message={testMessage} />
        ) : null}
      </BackendModeCard>
    </div>
  );
}
