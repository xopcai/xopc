/**
 * Global dreaming animation overlay.
 *
 * Renders a fixed, full-screen, pointer-events-none canvas that shows
 * Three.js animations when agent dreaming phases execute.
 *
 * Mount once inside `<AppShell>`. Listens to SSE events + manual triggers.
 */
import { useCallback, useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';
import { useThemeStore } from '@/stores/theme-store';

import { DreamingScene } from './dreaming-scene';
import { useDreamingEvents } from './use-dreaming-events';

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
  const sceneRef = useRef<DreamingScene | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, dismiss } = useDreamingEvents();

  // Initialize / dispose Three.js scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dreamScene = new DreamingScene(canvas);
    sceneRef.current = dreamScene;

    return () => {
      dreamScene.dispose();
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

  // Force dark mode while dreaming animation is active
  const savedThemeRef = useRef<'light' | 'dark' | 'system' | null>(null);
  const setPreference = useThemeStore((s) => s.setPreference);
  const currentPreference = useThemeStore((s) => s.preference);
  const resolved = useThemeStore((s) => s.resolved);

  useEffect(() => {
    if (state.status === 'running') {
      // Save current theme and force dark if not already dark
      if (savedThemeRef.current === null) {
        savedThemeRef.current = currentPreference;
      }
      if (resolved !== 'dark') {
        setPreference('dark');
      }
    } else if (state.status === 'idle' && savedThemeRef.current !== null) {
      // Restore original theme when animation completes
      const saved = savedThemeRef.current;
      savedThemeRef.current = null;
      setPreference(saved);
    }
  }, [state.status, resolved, currentPreference, setPreference]);

  // Drive animation based on state
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (state.status === 'running') {
      if (prefersReducedMotion()) return; // skip animation entirely
      scene.startPhase(state.phase);
    } else if (state.status === 'fading-out') {
      scene.fadeOut();
    }
  }, [state]);

  // Initial size after mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sceneRef.current) return;
    sceneRef.current.resize(container.clientWidth, container.clientHeight);
  }, []);

  const isActive = state.status !== 'idle';
  const phase = state.status !== 'idle' ? state.phase : null;
  const isFading = state.status === 'fading-out';

  const handleDismiss = useCallback(() => {
    dismiss();
  }, [dismiss]);

  if (!isActive && !isFading) {
    return (
      <div ref={containerRef} className="pointer-events-none fixed inset-0 z-[90]" aria-hidden>
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'fixed inset-0 z-[90] transition-opacity',
        isFading ? 'dreaming-overlay-exit pointer-events-none' : 'dreaming-overlay-enter',
      )}
      role="status"
      aria-live="polite"
      aria-label={phase ? PHASE_LABELS[phase] : undefined}
    >
      {/* Three.js canvas — always pointer-events-none */}
      <canvas ref={canvasRef} className="pointer-events-none h-full w-full" />

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
