import type { BrowserActionInput, BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';

import type { BrowserRuntime } from '../runtime/browser-runtime.js';
import type { BrowserAutomationDefinition, BrowserAutomationStep, BrowserSemanticTarget } from './types.js';

export async function runBrowserAutomation(input: {
  definition: BrowserAutomationDefinition;
  inputs: Record<string, unknown>;
  runtime: BrowserRuntime;
  taskKey: string;
  signal: AbortSignal;
  onStep: (event: { index: number; action: string; status: 'started' | 'completed' | 'failed'; result?: BrowserControlResult }) => void;
}): Promise<BrowserControlResult> {
  const startedAt = Date.now();
  const values = resolveBrowserAutomationInputs(input.definition, input.inputs);
  let observation: BrowserObservation | undefined;
  let sessionId: string | undefined;

  for (let index = 0; index < input.definition.steps.length; index += 1) {
    const step = input.definition.steps[index]!;
    input.onStep({ index, action: step.action, status: 'started' });
    try {
      if (step.action !== 'navigate' && !observation) {
        const observed = await input.runtime.execute(input.taskKey, { action: 'observe', sessionId }, input.signal);
        if (!observed.ok) {
          input.onStep({ index, action: step.action, status: 'failed', result: observed });
          return observed;
        }
        observation = observed.receipt.observation;
        sessionId = observation?.sessionId;
      }
      if (step.action === 'navigate') {
        assertAllowedDomain(input.definition.allowedDomains, render(step.url, values));
      }
      const action = buildAction(step, values, observation, sessionId);
      const result = await input.runtime.execute(input.taskKey, action, input.signal);
      if (!result.ok) {
        input.onStep({ index, action: step.action, status: 'failed', result });
        return result;
      }
      observation = result.receipt.observation ?? observation;
      sessionId = observation?.sessionId ?? sessionId;
      if (step.action === 'navigate') {
        assertAllowedDomain(input.definition.allowedDomains, observation?.url ?? render(step.url, values));
      }
      input.onStep({ index, action: step.action, status: 'completed', result });
    } catch (error) {
      const result = automationFailure(
        step.action === 'navigate' ? 'BLOCKED_URL' : 'INVALID_INPUT',
        error,
        observation,
      );
      input.onStep({ index, action: step.action, status: 'failed', result });
      return result;
    }
  }

  return {
    ok: true,
    receipt: {
      action: 'sequence',
      risk: input.definition.risk,
      durationMs: Date.now() - startedAt,
      verified: true,
      observation,
    },
  };
}

function buildAction(
  step: BrowserAutomationStep,
  inputs: Record<string, unknown>,
  observation: BrowserObservation | undefined,
  sessionId: string | undefined,
): BrowserActionInput {
  if (step.action === 'navigate') return { ...step, url: render(step.url, inputs), sessionId };
  if (!observation) throw new Error('Browser observation is unavailable.');
  const revision = observation.revision;
  const ref = 'target' in step && step.target ? resolveTarget(step.target, observation) : undefined;
  switch (step.action) {
    case 'click': return { action: 'click', sessionId, revision, ref: ref!, expect: step.expect };
    case 'fill': return { action: 'fill', sessionId, revision, ref: ref!, value: render(step.value, inputs), submit: step.submit, expect: step.expect };
    case 'select': return { action: 'select', sessionId, revision, ref: ref!, value: render(step.value, inputs), expect: step.expect };
    case 'press': return { action: 'press', sessionId, revision, ref, key: render(step.key, inputs), expect: step.expect };
    case 'scroll': return { action: 'scroll', sessionId, revision, ref, deltaY: step.deltaY, expect: step.expect };
    case 'wait': return { action: 'wait', sessionId, revision, ref, condition: step.condition, value: step.value ? render(step.value, inputs) : undefined, timeoutMs: step.timeoutMs };
  }
}

function resolveTarget(target: BrowserSemanticTarget, observation: BrowserObservation): string {
  const matches = observation.nodes.filter((node) =>
    node.role === target.role
    && (!target.name || node.name === target.name)
    && (!target.nameIncludes || node.name.includes(target.nameIncludes)),
  );
  if (matches.length !== 1) {
    throw new Error(`Semantic target must match exactly one element; matched ${matches.length}: ${JSON.stringify(target)}`);
  }
  return matches[0]!.ref;
}

function render(value: string, inputs: Record<string, unknown>): string {
  return value.replace(/\$\{input\.([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, key: string) => {
    if (!(key in inputs)) throw new Error(`Missing automation input: ${key}`);
    return String(inputs[key]);
  });
}

export function resolveBrowserAutomationInputs(
  definition: BrowserAutomationDefinition,
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const values = { ...provided };
  for (const [name, spec] of Object.entries(definition.inputs)) {
    const value = values[name] ?? spec.default;
    if (value === undefined && spec.required) throw new Error(`Missing required automation input: ${name}`);
    if (value !== undefined && typeof value !== spec.type) throw new Error(`Automation input ${name} must be ${spec.type}.`);
    if (values[name] === undefined && value !== undefined) values[name] = value;
  }
  for (const name of Object.keys(values)) {
    if (!definition.inputs[name]) throw new Error(`Unknown automation input: ${name}`);
  }
  return values;
}

function assertAllowedDomain(allowedDomains: string[], url: string): void {
  const host = new URL(url).hostname.toLowerCase();
  if (!allowedDomains.some((domain) => domain.toLowerCase() === host)) {
    throw new Error(`Automation navigated outside its allowed domains: ${host}`);
  }
}

function automationFailure(
  code: 'BLOCKED_URL' | 'INVALID_INPUT',
  error: unknown,
  observation?: BrowserObservation,
): BrowserControlResult {
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
      observation,
    },
  };
}
