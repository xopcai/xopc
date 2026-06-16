import type { Config } from '../../config/schema.js';
import { getAgentDefaultModelRef } from '../../config/schema.js';
import { getDefaultModelSync } from '../../providers/index.js';
import type { MediaRef } from '../../channels/attachments/inbound-persist.js';
import { buildTranscriptUserMessage } from '../inbound/attachment-pipeline.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';

export type { InboundAttachmentInput as DirectInboundWireAttachment } from '../../channels/attachments/inbound-persist.js';
export type { MediaRef as DirectInboundAttachment } from '../../channels/attachments/inbound-persist.js';

export async function buildDirectUserMessageContent(opts: {
  content: string;
  attachments?: MediaRef[];
  sessionKey?: string;
  config: Config;
  agentManager: AgentInstanceGateway;
  modelManager: ModelManager;
}) {
  const sk = opts.sessionKey ?? '';
  const modelRef =
    sk !== ''
      ? opts.modelManager.getModelForSession(sk)
      : getAgentDefaultModelRef(opts.config) ?? getDefaultModelSync(opts.config);

  return buildTranscriptUserMessage({
    text: opts.content,
    prepared: opts.attachments,
    sessionKey: sk,
    modelRef: modelRef || getDefaultModelSync(opts.config),
    config: opts.config,
    agentManager: opts.agentManager,
  });
}
