import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TuiModelChoice } from './tui-backend.js';

const STORE_PATH = join(homedir(), '.xopc', 'tui-scoped-models.json');

type ScopedModelsFile = {
  /** `null` = all models enabled for Ctrl+P cycle. */
  byWorkspace?: Record<string, string[] | null>;
};

function normalizeWorkspaceKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

function readStore(): ScopedModelsFile {
  try {
    if (!existsSync(STORE_PATH)) return {};
    const raw = readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ScopedModelsFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(data: ScopedModelsFile): void {
  const dir = join(homedir(), '.xopc');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(STORE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Load scoped model refs for Ctrl+P cycling (`null` = all models). */
export function loadScopedModelRefs(cwd: string = process.cwd()): string[] | null {
  const key = normalizeWorkspaceKey(cwd);
  const store = readStore();
  const entry = store.byWorkspace?.[key];
  if (entry === undefined) return null;
  if (entry === null) return null;
  return [...entry];
}

/** Persist scoped model refs for this workspace. Pass `null` to enable all models. */
export function saveScopedModelRefs(
  refs: string[] | null,
  cwd: string = process.cwd(),
): void {
  const key = normalizeWorkspaceKey(cwd);
  const store = readStore();
  const byWorkspace = { ...store.byWorkspace };
  if (refs === null) {
    byWorkspace[key] = null;
  } else {
    byWorkspace[key] = [...refs];
  }
  writeStore({ byWorkspace });
}

export function modelRef(choice: TuiModelChoice): string {
  return `${choice.provider}/${choice.id}`;
}

/** Filter catalog by scoped refs; `null` means full catalog, empty array means no scoped models. */
export function filterModelsForCycle(
  catalog: TuiModelChoice[],
  scopedRefs: string[] | null,
): TuiModelChoice[] {
  if (scopedRefs === null) return catalog;
  if (scopedRefs.length === 0) return [];
  const order = new Map(scopedRefs.map((ref, idx) => [ref, idx]));
  return catalog
    .filter((m) => order.has(modelRef(m)))
    .toSorted((a, b) => (order.get(modelRef(a)) ?? 0) - (order.get(modelRef(b)) ?? 0));
}
