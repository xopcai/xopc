/**
 * Global dreaming animation overlay.
 *
 * Renders a fixed, full-screen, pointer-events-none canvas that shows
 * Three.js animations when agent dreaming phases execute.
 *
 * Mount once inside `<AppShell>`. Listens to SSE events + manual triggers.
 */
import { useCallback, useEffect, useRef } from 'react';

import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { cn } from '@/lib/cn';

import { useDreamingEvents } from './use-dreaming-events';

type DreamingSceneInstance = import('./dreaming-scene').DreamingScene;

const PHASE_LABELS: Record<string, string> = {
  light: '💤 Light Sleep — scanning memories…',
  deep: '🌙 Deep Sleep — promoting memories…',
  rem: '🌈 REM Sleep — discovering patterns…',
};

/** Check prefers-reduced-motion */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function DreamingOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<DreamingSceneInstance | null>(null);
  const sceneLoadingRef = useRef<Promise<DreamingSceneInstance | null> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, dismiss } = useDreamingEvents();

  const ensureScene = useCallback(async (): Promise<DreamingSceneInstance | null> => {
    if (sceneRef.current) return sceneRef.current;
    if (sceneLoadingRef.current) return sceneLoadingRef.current;

    const canvas = canvasRef.current;
    if (!canvas) return null;

    sceneLoadingRef.current = import('./dreaming-scene')
      .then(({ DreamingScene }) => {
        if (!canvas.isConnected) return null;
        const dreamScene = new DreamingScene(canvas);
        sceneRef.current = dreamScene;
        const container = containerRef.current;
        if (container) {
          dreamScene.resize(container.clientWidth, container.clientHeight);
        }
        return dreamScene;
      })
      .finally(() => {
        sceneLoadingRef.current = null;
      });

    return sceneLoadingRef.current;
  }, []);

  // Dispose Three.js only if it was needed.
  useEffect(() => {
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      if (!container || !sceneRef.current) return;
      sceneRef.current.resize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Drive animation based on state
  useEffect(() => {
    if (state.status === 'running') {
      if (prefersReducedMotion()) return; // skip animation entirely
      let cancelled = false;
      void ensureScene().then((scene) => {
        if (cancelled || !scene) return;
        scene.startPhase(state.phase);
      });
      return () => {
        cancelled = true;
      };
    } else if (state.status === 'fading-out') {
      sceneRef.current?.fadeOut();
    }
  }, [ensureScene, state]);

  // Initial size after mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sceneRef.current) return;
    sceneRef.current.resize(container.clientWidth, container.clientHeight);
  }, []);

  const isActive = state.status !== 'idle';
  const phase = state.status !== 'idle' ? state.phase : null;
  const isFading = state.status === 'fading-out';
  const agents = state.status !== 'idle' ? state.agents : [];

  const handleDismiss = useCallback(() => {
    dismiss();
  }, [dismiss]);

  if (!isActive && !isFading) {
    return (
      <div
        ref={containerRef}
        className="pointer-events-none fixed inset-0 z-[90] opacity-0"
        aria-hidden
      >
        <canvas ref={canvasRef} className="size-full" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        // Always use the default theme's dark background for the dreaming overlay.
        // (Matches `html.dark` `--color-surface-base` = #1c1c1e in globals.css.)
        'fixed inset-0 z-[90] bg-[#1c1c1e]/70 transition-opacity',
        isFading ? 'dreaming-overlay-exit pointer-events-none' : 'dreaming-overlay-enter',
      )}
      role="status"
      aria-live="polite"
      aria-label={phase ? PHASE_LABELS[phase] : undefined}
    >
      {/* Three.js canvas — always pointer-events-none */}
      <canvas ref={canvasRef} className="pointer-events-none size-full" />

      {agents.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-4 top-[15%] flex justify-center sm:inset-x-10">
          <div className="grid max-w-4xl grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {agents.slice(0, 12).map((agent, index) => (
              <div
                key={agent.key}
                className={cn(
                  'dreaming-agent-sleeper flex flex-col items-center gap-2',
                  agent.status === 'waking' && 'dreaming-agent-wake',
                )}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <div className="relative">
                  <div className="absolute inset-[-18px] rounded-full bg-white/10 blur-2xl" />
                  <AgentAvatarDisplay
                    agentId={agent.agentId || `dreaming-${index}`}
                    avatar={agent.avatar}
                    size={78}
                    className="relative size-[78px] border border-white/20 shadow-float ring-4 ring-white/10"
                  />
                  {agent.status === 'sleeping' ? (
                    <>
                      <span className="dreaming-agent-z dreaming-agent-z-a">Z</span>
                      <span className="dreaming-agent-z dreaming-agent-z-b">Z</span>
                      <span className="dreaming-agent-z dreaming-agent-z-c">Z</span>
                    </>
                  ) : null}
                </div>
                <div className="max-w-28 truncate rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-medium text-white/80 shadow-elevated backdrop-blur-md">
                  {agent.agentName || agent.agentId}
                </div>
              </div>
            ))}
            {agents.length > 12 ? (
              <div className="flex items-center justify-center rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white/75 backdrop-blur-md">
                +{agents.length - 12}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Phase indicator pill + dismiss button */}
      <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3">
        {phase ? (
          <div
            className={cn(
              'flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-elevated backdrop-blur-sm',
              'dreaming-pill-enter',
              phase === 'light' && 'border-emerald-400/30 bg-emerald-950/60 text-emerald-300',
              phase === 'deep' && 'border-indigo-400/30 bg-indigo-950/60 text-indigo-300',
              phase === 'rem' && 'border-purple-400/30 bg-purple-950/60 text-purple-300',
            )}
          >
            <span className="dreaming-pulse-dot" />
            <span>{PHASE_LABELS[phase]}</span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-full border border-edge-subtle bg-surface-panel/80 px-3 py-1.5 text-xs text-fg-muted shadow-elevated backdrop-blur-sm transition-colors hover:bg-surface-hover hover:text-fg"
          aria-label="Dismiss dreaming animation"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
