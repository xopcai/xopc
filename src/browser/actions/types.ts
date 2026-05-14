/**
 * Browser Action types — shared by browser_use tool, CLI, and pipeline runner.
 */

import type { Page } from 'playwright-core';

import type { Config } from '../../config/schema.js';
import type { BrowserManager } from '../manager.js';
import type { CdpSupervisor } from '../cdp-supervisor.js';

// ─── Action names ───────────────────────────────────────────────────────────

export type BrowserActionName =
  | 'open'
  | 'navigate'
  | 'state'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'input'
  | 'scroll'
  | 'screenshot'
  | 'back'
  | 'keys'
  | 'press'
  | 'console'
  | 'eval'
  | 'evaluate'
  | 'images'
  | 'dialog'
  | 'cdp'
  | 'close'
  | 'wait'
  | 'assert'
  | 'output'
  | 'network_start'
  | 'network_events'
  | 'network_stop';

// ─── Artifact ───────────────────────────────────────────────────────────────

export interface BrowserArtifact {
  type: 'screenshot' | 'file' | 'network_har';
  path?: string;
  /** Base64 data (screenshots returned inline when no path). */
  data?: string;
  mimeType?: string;
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

export interface BrowserDiagnostics {
  url?: string;
  title?: string;
  snapshot?: string;
  screenshot?: string;
  console?: string[];
  network?: string[];
  warnings?: string[];
}

// ─── Action Result ──────────────────────────────────────────────────────────

export interface BrowserActionResult {
  ok: boolean;
  /** The action that was executed. */
  action: string;
  /** Structured output data (e.g. extracted content, page state). */
  data?: unknown;
  /** Text summary for display / LLM consumption. */
  text?: string;
  /** Error details on failure. */
  error?: {
    code: string;
    message: string;
  };
  artifacts?: BrowserArtifact[];
  diagnostics?: BrowserDiagnostics;
}

// ─── Action Context ─────────────────────────────────────────────────────────

export interface BrowserActionContext {
  page: Page;
  manager: BrowserManager;
  config: Config | undefined;
  taskId: string;
  supervisor?: CdpSupervisor;
  signal?: AbortSignal;
  /** Current pipeline data accumulator (set during pipeline execution). */
  pipelineData?: unknown;
}

// ─── Action Handler ─────────────────────────────────────────────────────────

export type BrowserActionHandler = (
  ctx: BrowserActionContext,
  args: Record<string, unknown>,
) => Promise<BrowserActionResult>;

// ─── Registry interface ─────────────────────────────────────────────────────

export interface BrowserActionRegistry {
  get(name: string): BrowserActionHandler | undefined;
  has(name: string): boolean;
  names(): string[];
  execute(name: string, ctx: BrowserActionContext, args: Record<string, unknown>): Promise<BrowserActionResult>;
}
