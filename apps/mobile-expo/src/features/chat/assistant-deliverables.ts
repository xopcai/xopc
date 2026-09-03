import type { ProductDeliveryEnvelope, TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import { extractMobileProductDelivery } from './product-delivery';
import type { Message, ToolUseContent } from './messages.types';

const DELIVERABLE_TOOL_NAMES = new Set([
  'write_file',
  'apply_patch',
  'exec_command',
  'publish_artifacts',
  'image_generate',
  'send_media',
  'create_share',
  'workflow',
  'automation',
  'xopc_use',
]);

export type AssistantDeliverables = {
  artifacts: TurnOutcomeDeliverable[];
  productDeliveries: ProductDeliveryEnvelope[];
  awaiting: boolean;
};

function deliveryKey(delivery: ProductDeliveryEnvelope): string {
  const reference = delivery.primary;
  return `${delivery.operation}:${reference?.kind ?? 'none'}:${reference?.id ?? 'none'}`;
}

export function collectAssistantDeliverables(
  message: Message,
  isStreaming: boolean,
): AssistantDeliverables {
  const tools = message.content.filter(
    (block): block is ToolUseContent => block.type === 'tool_use',
  );
  const completedTools = tools.filter((block) => block.status === 'done');
  const deliveries = completedTools
    .map(extractMobileProductDelivery)
    .filter((delivery): delivery is ProductDeliveryEnvelope => delivery !== null);
  const inlineAudioUris = new Set(message.content.flatMap((block) => (
    block.type === 'audio' && block.uri ? [block.uri] : []
  )));
  const artifacts = Array.from(new Map(
    (message.outcome?.deliverables ?? [])
      .filter((artifact) => !artifact.uri || !inlineAudioUris.has(artifact.uri))
      .map((artifact) => [artifact.artifactId, artifact]),
  ).values());
  const productDeliveries = Array.from(
    new Map(
      deliveries
        .filter((delivery) => delivery.primary?.kind !== 'file')
        .map((delivery) => [deliveryKey(delivery), delivery]),
    ).values(),
  );

  return {
    artifacts,
    productDeliveries,
    awaiting: isStreaming && tools.some(
      (block) => block.status === 'running' && DELIVERABLE_TOOL_NAMES.has(block.name),
    ),
  };
}
