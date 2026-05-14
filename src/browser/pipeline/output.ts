/**
 * Pipeline output formatting — standardize pipeline results for tool consumption.
 */

import type { BrowserActionResult, BrowserArtifact, BrowserDiagnostics } from '../actions/types.js';

export interface PipelineOutput {
  ok: boolean;
  name: string;
  /** Final output data (from `output` action or last step data). */
  data: unknown;
  /** All artifacts collected during the pipeline. */
  artifacts: BrowserArtifact[];
  /** Diagnostics from failed steps or on_error. */
  diagnostics: BrowserDiagnostics;
  /** Per-step results summary. */
  steps: { action: string; ok: boolean; text?: string }[];
  /** Error from the failed step (if any). */
  error?: { step: number; action: string; code: string; message: string };
}

export function createPipelineOutput(name: string): PipelineOutput {
  return {
    ok: true,
    name,
    data: undefined,
    artifacts: [],
    diagnostics: { warnings: [] },
    steps: [],
  };
}

export function addStepResult(output: PipelineOutput, stepIndex: number, result: BrowserActionResult): void {
  output.steps.push({ action: result.action, ok: result.ok, text: result.text?.slice(0, 200) });

  if (result.artifacts) {
    output.artifacts.push(...result.artifacts);
  }

  if (!result.ok) {
    output.ok = false;
    output.error = {
      step: stepIndex,
      action: result.action,
      code: result.error?.code ?? 'UNKNOWN',
      message: result.error?.message ?? 'Step failed',
    };
  }

  // Merge diagnostics
  if (result.diagnostics) {
    if (result.diagnostics.url) output.diagnostics.url = result.diagnostics.url;
    if (result.diagnostics.title) output.diagnostics.title = result.diagnostics.title;
    if (result.diagnostics.snapshot) output.diagnostics.snapshot = result.diagnostics.snapshot;
    if (result.diagnostics.screenshot) output.diagnostics.screenshot = result.diagnostics.screenshot;
    if (result.diagnostics.console) output.diagnostics.console = result.diagnostics.console;
    if (result.diagnostics.network) output.diagnostics.network = result.diagnostics.network;
    if (result.diagnostics.warnings) output.diagnostics.warnings!.push(...result.diagnostics.warnings);
  }
}

/**
 * Format a PipelineOutput into a BrowserActionResult for tool consumption.
 */
export function formatPipelineResult(output: PipelineOutput): BrowserActionResult {
  if (output.ok) {
    const text = output.data
      ? (typeof output.data === 'string' ? output.data : JSON.stringify(output.data, null, 2))
      : `Pipeline "${output.name}" completed (${output.steps.length} steps).`;
    return {
      ok: true,
      action: 'pipeline',
      text,
      data: output.data,
      artifacts: output.artifacts.length > 0 ? output.artifacts : undefined,
    };
  }

  const errText = output.error
    ? `Pipeline "${output.name}" failed at step ${output.error.step + 1} (${output.error.action}): [${output.error.code}] ${output.error.message}`
    : `Pipeline "${output.name}" failed.`;
  return {
    ok: false,
    action: 'pipeline',
    text: errText,
    error: output.error ? { code: output.error.code, message: output.error.message } : { code: 'PIPELINE_FAILED', message: errText },
    artifacts: output.artifacts.length > 0 ? output.artifacts : undefined,
    diagnostics: output.diagnostics,
  };
}
