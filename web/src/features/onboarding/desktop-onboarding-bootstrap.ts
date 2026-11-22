import { importRequest, type DetectedImportSource, type ImportInventory, type ImportSource, type ProductImportResult } from '@/features/imports/import-api';
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
};

let pendingPreload: Promise<DesktopOnboardingPreload> | null = null;

export function resetDesktopOnboardingPreload(): void {
  pendingPreload = null;
}

/**
 * Zero-prompt read-only local discovery warm-up (projects, recent docs metadata, and Claude/Codex detection).
 * Never triggers OS permission dialogs.
 */
export function prefetchDesktopOnboardingContext(force = false): Promise<DesktopOnboardingPreload> {
  if (!force && pendingPreload) return pendingPreload;
  const run = Promise.allSettled([
    discoverWorkDiscoveryCandidates(),
    importRequest<{ sources: DetectedImportSource[] }>('/sources'),
  ]).then(([discovery, imports]) => {
    const candidates = discovery.status === 'fulfilled' ? discovery.value.candidates : [];
    const recentFiles = discovery.status === 'fulfilled' ? discovery.value.recentFiles : [];
    const processingTarget = discovery.status === 'fulfilled' ? discovery.value.processingTarget : null;
    const importSources = imports.status === 'fulfilled'
      ? imports.value.sources.filter((source) => source.detected && !source.lastImport)
      : [];
    return { candidates, recentFiles, processingTarget, importSources };
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
        .filter((item) => item.status === 'ready' && item.suggested && item.kind !== 'connection')
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
