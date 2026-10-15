import { parseResultReferenceId, resultReferenceVersion } from '@xopcai/gateway-contract';

import { resolvePersonalResultReference } from '../../personal-agent/result-reader.js';
import type { AgentSourceContext } from './types.js';

export function buildResultAgentContext(conversationId: string, sourceId: string, expectedVersion?: string): AgentSourceContext | null {
  const selection = parseResultReferenceId(sourceId);
  if (!selection) return null;
  try {
    const delivery = resolvePersonalResultReference(conversationId, selection.resultId);
    const version = resultReferenceVersion(delivery);
    if (expectedVersion && expectedVersion !== version) return null;
    const artifact = selection.sourceId === 'body' ? undefined : delivery.outcome.deliverables.find(item => item.artifactId === selection.sourceId);
    if (selection.sourceId !== 'body' && !artifact) return null;
    return { kind: 'result', sourceId, version, title: artifact?.title ?? delivery.taskTitle,
      text: JSON.stringify({ ...selection, taskId: delivery.taskId, version,
        guidance: 'The user selected this result. Read its exact content with personal_result; this reference is not the full source.' }) };
  } catch { return null; }
}
