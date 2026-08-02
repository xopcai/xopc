export type BrowserRecipeStatus = 'published' | 'disabled';
export type BrowserRecipeRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BrowserRecipe {
  id: string;
  revision: number;
  name: string;
  description?: string;
  status: BrowserRecipeStatus;
  yaml: string;
  risk: 'read_only' | 'account_write' | 'sensitive';
  domains: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BrowserRecipeRun {
  id: string;
  recipeId: string;
  recipeRevision: number;
  recipeYaml: string;
  status: BrowserRecipeRunStatus;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
}

export interface BrowserRecipeRunEvent {
  id: string;
  runId: string;
  seq: number;
  type: string;
  data?: unknown;
  createdAtMs: number;
}
