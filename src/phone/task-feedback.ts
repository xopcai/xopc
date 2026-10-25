import type { PhoneReport, PhoneTaskFeedback, PhoneRequestedOutput, PhoneObservation } from './contracts.js';

export function nativePhoneOutput(request: PhoneRequestedOutput, observation: PhoneObservation): PhoneTaskFeedback['outputs'][number] {
  const selector = request.selector;
  const nodes = selector ? observation.elements.filter(node => !node.password && node.bounds[0] >= 0 && node.bounds[1] >= 0
    && node.bounds[2] <= observation.width && node.bounds[3] <= observation.height && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1]
    && (!selector.resourceId || node.resourceId === selector.resourceId) && (!selector.text || node.text === selector.text)
    && (!selector.description || node.description === selector.description)) : [];
  const value = nodes.length === 1 ? nodes[0].text || nodes[0].description : undefined;
  return { key: request.key, ...(value ? { value: value.slice(0, 4000) } : {}), source: 'native_ui',
    verification: value ? 'observed' : 'unavailable', frameId: observation.frameId, capturedAt: observation.capturedAt,
    ...(!value ? { reason: nodes.length > 1 ? 'ambiguous_native_output' : 'native_output_unavailable' } : {}) };
}

/** Completion is evidence-based; dispatch and model summaries never establish success. */
export function updatePhoneFeedback(report: PhoneReport, usage: PhoneTaskFeedback['usage'], previous?: PhoneTaskFeedback): PhoneTaskFeedback | undefined {
  if (!report.task || !previous) return undefined;
  const inspection = report.status === 'outcome_unknown' || report.status !== 'running' && report.steps.at(-1)?.dispatch === 'unknown';
  const stopped = report.stopReason === 'cancel' || report.status === 'cancelled' || report.status === 'closed';
  const exhausted = ['action_limit', 'task_action_limit', 'operation_timeout'].includes(report.stopReason ?? '') || ['PHONE_MODEL_LIMIT', 'PHONE_ACTION_LIMIT'].includes(report.errorCode ?? '');
  const outcome: PhoneTaskFeedback['outcome'] = inspection ? 'needs_user' : stopped ? 'cancelled' : exhausted ? 'partial'
    : report.status === 'running' ? 'running' : report.status === 'needs_user' ? 'needs_user'
    : report.status === 'failed' ? 'failed' : report.status === 'paused' ? 'blocked'
    : report.verified && report.status === 'completed' ? 'completed' : 'partial';
  const outputs = previous.outputs;
  const missing = outputs.filter(output => output.verification === 'unavailable').map(output => `Output unavailable: ${output.key}`);
  return { ...previous, outcome, stopReason: report.stopReason, verified: report.verified, verificationLevel: report.verified ? report.verificationLevel : 'none',
    progress: { completed: report.verified ? ['Declared UI completion conditions satisfied'] : [],
      remaining: [...(report.verified ? [] : ['Current goal has not been verified']), ...missing], source: 'runtime' },
    outputs, evidence: structuredClone(report.readings ?? []), usage,
    nextAction: inspection || report.stopReason === 'operation_timeout' ? 'inspect' : exhausted && report.stopReason !== 'action_limit' ? 'user' : outcome === 'needs_user' ? 'user' : outcome === 'running' ? 'wait'
      : outcome === 'completed' ? 'done' : outcome === 'partial' ? 'replan' : outcome === 'blocked' ? 'inspect' : 'user' };
}
