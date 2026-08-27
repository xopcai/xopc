import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Check, Eraser, Play, Plus, RotateCcw, Share2, Square, SquareTerminal, X } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { resolveSession } from '@/features/sessions/session-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { shareTerminalOutput } from '@/features/chat/terminal/terminal-output-api';
import {
  clampTerminalHeight,
  TERMINALS_PER_SESSION_MAX,
  useTerminalPanelStore,
} from '@/stores/terminal-panel-store';

import './chat-terminal-dock.css';

type TerminalState = 'connecting' | 'running' | 'stopped' | 'error';

function terminalDimensions(terminal: Terminal): { cols: number; rows: number } {
  return {
    cols: Math.min(500, Math.max(20, terminal.cols)),
    rows: Math.min(300, Math.max(5, terminal.rows)),
  };
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: color('--color-surface-base', '#0f172a'),
    foreground: color('--color-fg', '#e2e8f0'),
    cursor: color('--color-accent', '#60a5fa'),
    selectionBackground: 'rgba(96, 165, 250, 0.28)',
  };
}

export function ChatTerminalDock({ sessionKey }: { sessionKey: string }) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language).chat.terminal;
  const api = window.electronAPI?.terminal;
  const open = useTerminalPanelStore((state) => Boolean(state.openBySessionKey[sessionKey]));
  const height = useTerminalPanelStore((state) => state.height);
  const tabs = useTerminalPanelStore((state) => state.tabsBySessionKey[sessionKey] ?? []);
  const terminalKey = useTerminalPanelStore((state) => state.activeTabKeyBySessionKey[sessionKey]);
  const closePanel = useTerminalPanelStore((state) => state.close);
  const addTerminal = useTerminalPanelStore((state) => state.addTerminal);
  const closeTerminal = useTerminalPanelStore((state) => state.closeTerminal);
  const setActiveTerminal = useTerminalPanelStore((state) => state.setActiveTerminal);
  const setHeight = useTerminalPanelStore((state) => state.setHeight);
  const approve = useTerminalPanelStore((state) => state.approve);
  const approvedSessionIds = useTerminalPanelStore((state) => state.approvedSessionIds);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const startRef = useRef<(() => Promise<void>) | null>(null);
  const outputRef = useRef('');
  const resizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sharedTimerRef = useRef<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cwd, setCwd] = useState('');
  const [state, setState] = useState<TerminalState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [rendered, setRendered] = useState(open);
  const [entering, setEntering] = useState(open);
  const [closing, setClosing] = useState(false);
  const approved = sessionId ? Boolean(approvedSessionIds[sessionId]) : false;

  useEffect(() => {
    if (open) {
      setRendered(true);
      setEntering(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    setEntering(false);
    setClosing(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  useEffect(() => () => {
    if (sharedTimerRef.current !== null) window.clearTimeout(sharedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!rendered || !api) {
      setSessionId(null);
      return;
    }
    let cancelled = false;
    setState('connecting');
    setError(null);
    void resolveSession({ sessionKey })
      .then((resolved) => {
        if (!cancelled) setSessionId(resolved.sessionId);
      })
      .catch((cause) => {
        if (cancelled) return;
        setState('error');
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, rendered, sessionKey]);

  useEffect(() => {
    if (!rendered || !api || !sessionId || !terminalKey || !approved || !containerRef.current) return;
    setCwd('');
    setState('connecting');
    setError(null);
    outputRef.current = '';
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5_000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;

    let disposed = false;
    let creating = false;
    const pendingData: Array<{ terminalId: string; data: string; sequence: number }> = [];
    const removeData = api.onData((event) => {
      const activeId = terminalIdRef.current;
      if (!activeId) {
        pendingData.push(event);
      } else if (event.terminalId === activeId) {
        outputRef.current = `${outputRef.current}${event.data}`.slice(-64_000);
        terminal.write(event.data);
      }
    });
    const removeExit = api.onExit((event) => {
      if (event.terminalId !== terminalIdRef.current) return;
      setState('stopped');
      terminal.write(`\r\n\x1b[90m${m.exited.replace('{{code}}', String(event.exitCode))}\x1b[0m\r\n`);
    });
    const removeError = api.onError((event) => {
      if (event.terminalId && event.terminalId !== terminalIdRef.current) return;
      setState('error');
      setError(event.message);
    });
    const inputDisposable = terminal.onData((data) => {
      if (terminalIdRef.current) api.write(terminalIdRef.current, data);
    });

    const fitAndResize = () => {
      if (disposed || !containerRef.current) return;
      fitAddon.fit();
      const terminalId = terminalIdRef.current;
      if (!terminalId) return;
      const { cols, rows } = terminalDimensions(terminal);
      void api.resize(terminalId, cols, rows).catch(() => undefined);
    };

    const start = async () => {
      if (creating || disposed) return;
      creating = true;
      setState('connecting');
      setError(null);
      try {
        fitAddon.fit();
        const descriptor = await api.create({
          sessionKey,
          sessionId,
          terminalKey,
          ...terminalDimensions(terminal),
        });
        if (disposed) return;
        terminalIdRef.current = descriptor.terminalId;
        setCwd(descriptor.cwd);
        outputRef.current = descriptor.replay.slice(-64_000);
        if (descriptor.replay) terminal.write(descriptor.replay);
        for (const event of pendingData) {
          if (event.terminalId === descriptor.terminalId && event.sequence > descriptor.replaySequence) {
            outputRef.current = `${outputRef.current}${event.data}`.slice(-64_000);
            terminal.write(event.data);
          }
        }
        pendingData.length = 0;
        setState(descriptor.exited ? 'stopped' : 'running');
        fitAndResize();
        terminal.focus();
      } catch (cause) {
        if (!disposed) {
          setState('error');
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        creating = false;
      }
    };
    startRef.current = start;

    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(containerRef.current);
    void start();

    return () => {
      disposed = true;
      startRef.current = null;
      terminalIdRef.current = null;
      terminalRef.current = null;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeData();
      removeExit();
      removeError();
      terminal.dispose();
    };
  }, [api, approved, m.exited, rendered, sessionId, sessionKey, terminalKey]);

  const stop = useCallback(async () => {
    const terminalId = terminalIdRef.current;
    if (!api || !terminalId) return;
    await api.close(terminalId);
    terminalIdRef.current = null;
    setState('stopped');
  }, [api]);

  const restart = useCallback(async () => {
    await stop();
    terminalRef.current?.reset();
    outputRef.current = '';
    await startRef.current?.();
  }, [stop]);

  const share = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal || sharing) return;
    setSharing(true);
    setShared(false);
    setError(null);
    try {
      await shareTerminalOutput(sessionKey, terminal.getSelection() || outputRef.current);
      setShared(true);
      if (sharedTimerRef.current !== null) window.clearTimeout(sharedTimerRef.current);
      sharedTimerRef.current = window.setTimeout(() => setShared(false), 2_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSharing(false);
    }
  }, [sessionKey, sharing]);

  const closeTerminalTab = useCallback((key: string) => {
    closeTerminal(sessionKey, key);
    if (!api || !sessionId) return;
    void api.dispose(sessionId, key).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [api, closeTerminal, sessionId, sessionKey]);

  if (!api || !rendered) return null;

  return (
    <section
      className={`relative flex shrink-0 flex-col overflow-hidden border-t border-edge bg-surface-base ${closing ? 'terminal-dock-exit pointer-events-none' : entering ? 'terminal-dock-enter' : ''}`}
      style={{
        height,
        '--terminal-dock-height': `${height}px`,
      } as CSSProperties}
      aria-label={m.title}
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target && !closing) setEntering(false);
      }}
    >
      <div
        className="absolute inset-x-0 top-0 z-10 h-1 cursor-row-resize"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeDragRef.current = { startY: event.clientY, startHeight: height };
        }}
        onPointerMove={(event) => {
          const drag = resizeDragRef.current;
          if (drag) setHeight(clampTerminalHeight(drag.startHeight + drag.startY - event.clientY));
        }}
        onPointerUp={() => {
          resizeDragRef.current = null;
        }}
        onPointerCancel={() => {
          resizeDragRef.current = null;
        }}
      />
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-edge-subtle px-2">
        <div className="flex min-w-0 max-w-[45%] items-center gap-1 overflow-x-auto" role="tablist" aria-label={m.title}>
          {tabs.map((tab, index) => {
            const active = tab.key === terminalKey;
            return (
              <div
                key={tab.key}
                className={active
                  ? 'flex h-7 shrink-0 items-center rounded-md bg-surface-hover text-fg'
                  : 'flex h-7 shrink-0 items-center rounded-md text-fg-muted hover:bg-surface-hover/60 hover:text-fg'}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="flex h-full min-w-0 items-center gap-1.5 pl-2 text-xs"
                  onClick={() => setActiveTerminal(sessionKey, tab.key)}
                >
                  <SquareTerminal className="size-3.5 shrink-0" />
                  <span className="max-w-32 truncate">{m.title} {index + 1}</span>
                </button>
                <button
                  type="button"
                  className="mr-1 rounded p-1 text-fg-muted hover:bg-surface-panel hover:text-fg"
                  title={m.closeTab}
                  aria-label={`${m.closeTab} ${index + 1}`}
                  onClick={() => closeTerminalTab(tab.key)}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-40"
          title={m.newTerminal}
          aria-label={m.newTerminal}
          disabled={tabs.length >= TERMINALS_PER_SESSION_MAX}
          onClick={() => addTerminal(sessionKey)}
        >
          <Plus className="size-4" />
        </button>
        {cwd ? <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-muted" title={cwd}>{cwd}</span> : <span className="flex-1" />}
        {approved && terminalKey ? (
          <div className="flex items-center gap-0.5">
            <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50" title={m.share} disabled={sharing || state === 'connecting'} onClick={() => void share()}>{shared ? <Check className="size-3.5 text-success" /> : <Share2 className="size-3.5" />}</button>
            <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg" title={m.clear} onClick={() => terminalRef.current?.clear()}><Eraser className="size-3.5" /></button>
            {state === 'running' ? (
              <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg" title={m.restart} onClick={() => void restart()}><RotateCcw className="size-3.5" /></button>
            ) : (
              <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50" title={m.start} disabled={state === 'connecting'} onClick={() => void restart()}><Play className="size-3.5" /></button>
            )}
            <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg" title={m.stop} disabled={state !== 'running'} onClick={() => void stop()}><Square className="size-3.5" /></button>
          </div>
        ) : null}
        <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg" title={m.hide} onClick={() => closePanel(sessionKey)}><X className="size-3.5" /></button>
      </header>
      {!terminalKey ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-fg-muted">
          <span>{m.noTerminals}</span>
          <Button variant="secondary" onClick={() => addTerminal(sessionKey)}>
            <Plus className="size-4" />
            {m.newTerminal}
          </Button>
        </div>
      ) : !sessionId && state === 'connecting' ? (
        <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">{m.preparing}</div>
      ) : sessionId && !approved ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-lg rounded-lg border border-edge bg-surface-panel p-5 text-center">
            <p className="text-sm font-medium text-fg">{m.permissionTitle}</p>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{m.permissionBody}</p>
            <Button className="mt-4" onClick={() => approve(sessionId)}>{m.enable}</Button>
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 p-2">
          <div ref={containerRef} className="h-full w-full overflow-hidden" />
          {error ? (
            <div className="absolute inset-x-3 bottom-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{error}</div>
          ) : null}
        </div>
      )}
    </section>
  );
}
