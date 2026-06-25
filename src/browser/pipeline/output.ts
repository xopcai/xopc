/**
 * Pipeline output formatting.
 */

import type { BrowserActionResult, BrowserArtifact, BrowserDiagnostics } from '../actions/types.js';

export interface PipelineStepTrace {
  index: number;
  scope: string;
  action: string;
  ok: boolean;
  elapsedMs: number;
  text?: string;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface PipelineOutput {
  ok: boolean;
  name: string;
  last: unknown;
  outputs: unknown[];
  artifacts: BrowserArtifact[];
  diagnostics: BrowserDiagnostics;
  trace: PipelineStepTrace[];
  error?: { step: number; action: string; code: string; message: string };
}

export function createPipelineOutput(name: string): PipelineOutput {
  return {
    ok: true,
    name,
    last: undefined,
    outputs: [],
    artifacts: [],
    diagnostics: { warnings: [] },
    trace: [],
  };
}

export function addStepTrace(output: PipelineOutput, trace: PipelineStepTrace, result: BrowserActionResult): void {
  output.trace.push(trace);

  if (result.artifacts) {
    output.artifacts.push(...result.artifacts);
  }

  if (!result.ok) {
    output.ok = false;
    output.error = {
      step: trace.index,
      action: result.action,
      code: result.error?.code ?? 'UNKNOWN',
      message: result.error?.message ?? 'Step failed',
    };
  }

  if (result.diagnostics) {
    if (result.diagnostics.url) output.diagnostics.url = result.diagnostics.url;
    if (result.diagnostics.title) output.diagnostics.title = result.diagnostics.title;
    if (result.diagnostics.snapshot) output.diagnostics.snapshot = result.diagnostics.snapshot;
    if (result.diagnostics.screenshot) output.diagnostics.screenshot = result.diagnostics.screenshot;
    if (result.diagnostics.console) output.diagnostics.console = result.diagnostics.console;
    if (result.diagnostics.network) output.diagnostics.network = result.diagnostics.network;
    if (result.diagnostics.warnings) {
      output.diagnostics.warnings ??= [];
      output.diagnostics.warnings.push(...result.diagnostics.warnings);
    }
  }
}

export function formatPipelineResult(output: PipelineOutput): BrowserActionResult {
  const data = {
    output: output.outputs.length === 0 ? output.last : output.outputs.length === 1 ? output.outputs[0] : output.outputs,
    last: output.last,
    outputs: output.outputs,
    trace: output.trace,
  };

  if (output.ok) {
    const textValue = data.output;
    const text = textValue === undefined
      ? `Pipeline "${output.name}" completed (${output.trace.length} steps).`
      : typeof textValue === 'string'
        ? textValue
        : JSON.stringify(textValue, null, 2);
    return {
      ok: true,
      action: 'pipeline',
      text,
      data,
      artifacts: output.artifacts.length > 0 ? output.artifacts : undefined,
      diagnostics: output.diagnostics,
    };
  }

  const errText = output.error
    ? `Pipeline "${output.name}" failed at step ${output.error.step + 1} (${output.error.action}): [${output.error.code}] ${output.error.message}`
    : `Pipeline "${output.name}" failed.`;
  return {
    ok: false,
    action: 'pipeline',
    text: errText,
    data,
    error: output.error ? { code: output.error.code, message: output.error.message } : { code: 'PIPELINE_FAILED', message: errText },
    artifacts: output.artifacts.length > 0 ? output.artifacts : undefined,
    diagnostics: output.diagnostics,
  };
}
