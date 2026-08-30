import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Plus, SquareTerminal, X } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { resolveSession } from '@/features/sessions/session-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import {
  clampTerminalHeight,
  selectTerminalTabs,
  TERMINALS_PER_SESSION_MAX,
  useTerminalPanelStore,
} from '@/stores/terminal-panel-store';

import './chat-terminal-dock.css';

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
  const tabs = useTerminalPanelStore((state) => selectTerminalTabs(state.tabsBySessionKey, sessionKey));
  const terminalKey = useTerminalPanelStore((state) => state.activeTabKeyBySessionKey[sessionKey]);
  const closePanel = useTerminalPanelStore((state) => state.close);
  const addTerminal = useTerminalPanelStore((state) => state.addTerminal);
  const closeTerminal = useTerminalPanelStore((state) => state.closeTerminal);
  const setActiveTerminal = useTerminalPanelStore((state) => state.setActiveTerminal);
  const setHeight = useTerminalPanelStore((state) => state.setHeight);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const resizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resolvingSession, setResolvingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(open);
  const [entering, setEntering] = useState(open);
  const [closing, setClosing] = useState(false);

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

  useEffect(() => {
    if (!rendered || !api) {
      setSessionId(null);
      return;
    }
    let cancelled = false;
    setResolvingSession(true);
    setError(null);
    void resolveSession({ sessionKey })
      .then((resolved) => {
        if (cancelled) return;
        setSessionId(resolved.sessionId);
        setResolvingSession(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setResolvingSession(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, rendered, sessionKey]);

  useEffect(() => {
    if (!rendered || !api || !sessionId || !terminalKey || !containerRef.current) return;
    setError(null);
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

    let disposed = false;
    let creating = false;
    const pendingData: Array<{ terminalId: string; data: string; sequence: number }> = [];
    const removeData = api.onData((event) => {
      const activeId = terminalIdRef.current;
      if (!activeId) {
        pendingData.push(event);
      } else if (event.terminalId === activeId) {
        terminal.write(event.data);
      }
    });
    const removeExit = api.onExit((event) => {
      if (event.terminalId !== terminalIdRef.current) return;
      terminal.write(`\r\n\x1b[90m${m.exited.replace('{{code}}', String(event.exitCode))}\x1b[0m\r\n`);
    });
    const removeError = api.onError((event) => {
      if (event.terminalId && event.terminalId !== terminalIdRef.current) return;
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
        if (descriptor.replay) terminal.write(descriptor.replay);
        for (const event of pendingData) {
          if (event.terminalId === descriptor.terminalId && event.sequence > descriptor.replaySequence) {
            terminal.write(event.data);
          }
        }
        pendingData.length = 0;
        fitAndResize();
        terminal.focus();
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        creating = false;
      }
    };

    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(containerRef.current);
    void start();

    return () => {
      disposed = true;
      terminalIdRef.current = null;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeData();
      removeExit();
      removeError();
      terminal.dispose();
    };
  }, [api, m.exited, rendered, sessionId, sessionKey, terminalKey]);

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
        <span className="flex-1" />
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
      ) : !sessionId && resolvingSession ? (
        <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">{m.preparing}</div>
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
