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
      if ('target' in step && step.target) {
        const resolved = await input.runtime.execute(input.taskKey, { action: 'resolve', sessionId, semanticTarget: step.target }, input.signal);
        if (!resolved.ok) { input.onStep({ index, action: step.action, status: 'failed', result: resolved }); return resolved; }
        observation = resolved.receipt.observation;
        sessionId = observation?.sessionId ?? sessionId;
      }
      if (observation) assertAllowedDomain(input.definition.allowedDomains, observation.url);
      if (step.action === 'click' && observation?.nodes[0]?.href) assertAllowedDomain(input.definition.allowedDomains, observation.nodes[0].href);
      const action = buildAction(step, values, observation, sessionId);
      const result = await input.runtime.execute(input.taskKey, action, input.signal);
      if (!result.ok) {
        input.onStep({ index, action: step.action, status: 'failed', result });
        return result;
      }
      observation = result.receipt.observation ?? observation;
      sessionId = observation?.sessionId ?? sessionId;
      if (observation) assertAllowedDomain(input.definition.allowedDomains, observation.url);
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

  const readField = async (spec: { target?: BrowserSemanticTarget; field: string }): Promise<string | boolean | undefined> => {
    if (spec.target) {
      const result = await input.runtime.execute(input.taskKey, { action: 'resolve', sessionId, semanticTarget: spec.target }, input.signal);
      if (!result.ok) return undefined;
      observation = result.receipt.observation;
    } else {
      const result = await input.runtime.execute(input.taskKey, { action: 'observe', sessionId, visual: 'never' }, input.signal);
      if (!result.ok) return undefined;
      observation = result.receipt.observation;
    }
    if (!observation) return undefined;
    assertAllowedDomain(input.definition.allowedDomains, observation.url);
    const node = observation.nodes[0];
    if (spec.field === 'url') return observation.url;
    if (spec.field === 'title') return observation.title;
    if (spec.field === 'checked') return node?.states.includes('checked');
    if (spec.field === 'text') return node?.description ?? node?.name;
    return node?.[spec.field as 'value' | 'href'];
  };
  try {
    for (const assertion of input.definition.successCriteria ?? []) {
      const deadline = Date.now() + 10_000;
      let passed = false;
      do {
        if (input.signal.aborted) return automationFailure('INVALID_INPUT', 'Run cancelled.', observation);
        const actual = await readField(assertion);
        passed = assertion.equals !== undefined ? actual === (typeof assertion.equals === 'string' ? render(assertion.equals, values) : assertion.equals)
          : typeof actual === 'string' && actual.includes(render(assertion.includes!, values));
        if (!passed) await new Promise((resolve) => setTimeout(resolve, 200));
      } while (!passed && Date.now() < deadline);
      if (!passed) return { ok: false, error: { code: 'EXPECTATION_FAILED', message: 'The business result did not match its success criteria.', observation } };
    }
    const outputs: Record<string, string> = {};
    for (const [name, spec] of Object.entries(input.definition.outputs ?? {})) {
      const value = await readField(spec);
      if (typeof value !== 'string' || !value) return { ok: false, error: { code: 'EXPECTATION_FAILED', message: `Output ${name} is unavailable.`, observation } };
      outputs[name] = value;
    }
    return {
    ok: true,
    receipt: {
      action: 'sequence',
      risk: input.definition.risk,
      durationMs: Date.now() - startedAt,
      verified: !!input.definition.successCriteria?.length,
      businessOutcome: input.definition.successCriteria?.length ? 'verified' : 'completed',
      outputs,
      observation,
    },
  };
  } catch (error) { return automationFailure('BLOCKED_URL', error, observation); }
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
    case 'check': return { action: 'check', sessionId, revision, ref: ref!, checked: step.checked };
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
    if (value !== undefined && spec.choices && !spec.choices.includes(value as string | number | boolean)) throw new Error(`Automation input ${name} is not an allowed choice.`);
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
