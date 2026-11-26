import { importRequest, type DetectedImportSource, type ImportInventory, type ImportSource, type ProductImportResult } from '@/features/imports/import-api';
import {
  fetchExternalAgentRuntimes,
  fetchExternalAgentRuntimesFast,
  type ExternalRuntimeFastDetection,
  type ExternalRuntimeProbeResult,
} from '@/features/settings/agents-admin-api';
import { createPriority } from '@/features/user-model/user-model-api';
import {
  discoverWorkDiscoveryCandidates,
  type WorkDiscoveryCandidate,
  type WorkDiscoveryProcessingTarget,
  type WorkDiscoveryRecentFile,
} from '@/features/work-discovery/api';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type DesktopOnboardingPreload = {
  candidates: WorkDiscoveryCandidate[];
  recentFiles: WorkDiscoveryRecentFile[];
  processingTarget: WorkDiscoveryProcessingTarget | null;
  importSources: DetectedImportSource[];
  externalRuntimesFast: ExternalRuntimeFastDetection[];
};

const ONBOARDING_PROBE_TIMEOUT_MS = 8_000;

let pendingPreload: Promise<DesktopOnboardingPreload> | null = null;
let pendingExternalFast: Promise<ExternalRuntimeFastDetection[]> | null = null;
let pendingExternalFull: Promise<ExternalRuntimeProbeResult[]> | null = null;

export function resetDesktopOnboardingPreload(): void {
  pendingPreload = null;
  pendingExternalFast = null;
  pendingExternalFull = null;
}

/**
 * Lightweight (<50ms) binary check for host-installed Codex, Antigravity, and Claude Code.
 * When at least one runtime is installed, automatically warms the full cached probe in the background.
 */
export function prefetchExternalRuntimesFast(force = false): Promise<ExternalRuntimeFastDetection[]> {
  if (!force && pendingExternalFast) return pendingExternalFast;
  const run = fetchExternalAgentRuntimesFast()
    .then((detections) => {
      if (detections.some((entry) => entry.installed)) {
        void prefetchExternalRuntimesFull(false).catch(() => {});
      }
      return detections;
    })
    .catch(() => []);
  pendingExternalFast = run;
  return run;
}

/**
 * Cached full probe for external runtimes, shared between Stage 1 warm-up and Stage 2 rendering.
 */
export function prefetchExternalRuntimesFull(force = false): Promise<ExternalRuntimeProbeResult[]> {
  if (!force && pendingExternalFull) return pendingExternalFull;
  const run = fetchExternalAgentRuntimes({
    refresh: force,
    timeoutMs: ONBOARDING_PROBE_TIMEOUT_MS,
  }).catch(() => []);
  pendingExternalFull = run;
  return run;
}

/**
 * Zero-prompt read-only local discovery warm-up (projects, recent docs metadata, Claude/Codex/Antigravity detection).
 * Never triggers OS permission dialogs.
 */
export function prefetchDesktopOnboardingContext(force = false): Promise<DesktopOnboardingPreload> {
  if (!force && pendingPreload) return pendingPreload;
  const run = Promise.allSettled([
    discoverWorkDiscoveryCandidates(),
    importRequest<{ sources: DetectedImportSource[] }>('/sources'),
    prefetchExternalRuntimesFast(force),
  ]).then(([discovery, imports, externalFast]) => {
    const candidates = discovery.status === 'fulfilled' ? discovery.value.candidates : [];
    const recentFiles = discovery.status === 'fulfilled' ? discovery.value.recentFiles : [];
    const processingTarget = discovery.status === 'fulfilled' ? discovery.value.processingTarget : null;
    const importSources = imports.status === 'fulfilled'
      ? imports.value.sources.filter((source) => source.detected && !source.lastImport)
      : [];
    const externalRuntimesFast = externalFast.status === 'fulfilled' ? externalFast.value : [];
    return { candidates, recentFiles, processingTarget, importSources, externalRuntimesFast };
  });
  pendingPreload = run;
  return run;
}

/**
 * Idempotently auto-initializes the default Personal Agent (Ada / Loopi) in the background
 * so Electron users never hit a redundant second 4-step wizard.
 */
export async function ensureDefaultPersonalAgent(): Promise<boolean> {
  try {
    const response = await fetchJson<{ ok: boolean; payload?: unknown }>(apiUrl('/api/personal-agent'), {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Ada', appearance: 'loopi' }),
    });
    if (response.payload) {
      window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: response.payload }));
      window.dispatchEvent(new Event('session-updated'));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function recordCurrentFocusPriority(rawTitle: string): Promise<void> {
  const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!title) return;
  try {
    await createPriority({
      title,
      validTo: Date.now() + 14 * 86_400_000,
    });
  } catch {
    // Recording priority enriches context but must never block the user from starting work.
  }
}

export async function importSafeAiToolConfigs(sources: ImportSource[]): Promise<{
  importedCount: number;
  skills: number;
  context: number;
  projects: number;
}> {
  let skills = 0;
  let context = 0;
  let projects = 0;

  for (const source of sources) {
    try {
      const inventory = await importRequest<ImportInventory>(`/sources/${encodeURIComponent(source)}/scan`, {});
      const readyIds = inventory.candidates
        .filter((item) => item.status === 'ready' && (item.suggested || item.kind === 'context') && item.kind !== 'connection')
        .map((item) => item.id);
      if (!readyIds.length) continue;
      const result = await importRequest<ProductImportResult>('/runs', {
        inventoryId: inventory.id,
        candidateIds: readyIds,
        requestId: crypto.randomUUID(),
      });
      skills += result.skills;
      context += result.context;
      projects += result.projects;
    } catch {
      // Partial or unavailable source import must never block onboarding.
    }
  }

  return { importedCount: skills + context + projects, skills, context, projects };
}
