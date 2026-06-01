import type { Config } from '../../config/schema.js';
import { getAgentDefaultModelRef } from '../../config/schema.js';
import { getDefaultModelSync } from '../../providers/index.js';
import { formatInboundFileTextBlock } from '../../channels/attachments/inbound-persist.js';
import { expandAtFileMentionsInPlainText } from '../context/expand-at-file-mentions.js';
import { resolveInboundImageContentParts } from '../image/inbound-image-handling.js';
import { resolveAgentHomeDir, resolveDefaultAgentId } from '../agent-scope.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';

export type DirectInboundAttachment = {
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  workspaceRelativePath?: string;
};

export type DirectMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/**
 * Build user message parts (text + resolved images/files) for direct / webchat turns.
 */
export async function buildDirectUserMessageContent(opts: {
  content: string;
  attachments?: DirectInboundAttachment[];
  sessionKey?: string;
  config: Config;
  agentManager: AgentInstanceGateway;
  modelManager: ModelManager;
}): Promise<DirectMessagePart[]> {
  const { content, attachments, sessionKey, config, agentManager, modelManager } = opts;
  const messageContent: DirectMessagePart[] = [];
  const sk = sessionKey ?? '';

  if (content.trim()) {
    let textPart = content;
    if (/@file:/.test(textPart)) {
      const wsKey = sk !== '' ? sk : 'cli:direct';
      const root = agentManager.getResolvedWorkspaceForSession(wsKey);
      textPart = await expandAtFileMentionsInPlainText(textPart, root);
    }
    messageContent.push({ type: 'text', text: textPart });
  }

  if (!attachments?.length) {
    return messageContent;
  }

  const modelRef =
    sk !== ''
      ? modelManager.getModelForSession(sk)
      : getAgentDefaultModelRef(config) ?? getDefaultModelSync(config);

  const storageRoot =
    sk !== ''
      ? resolveAgentHomeDir(config, extractProfileAgentId(sk, config))
      : resolveAgentHomeDir(config, resolveDefaultAgentId(config));

  let i = 0;
  while (i < attachments.length) {
    const att = attachments[i]!;
    const isImage =
      att.type === 'image' ||
      att.type === 'photo' ||
      Boolean(att.mimeType?.startsWith('image/'));

    if (isImage) {
      const group: Array<{ data: string; mimeType: string }> = [];
      while (i < attachments.length) {
        const a = attachments[i]!;
        const img = a.type === 'image' || a.type === 'photo' || Boolean(a.mimeType?.startsWith('image/'));
        if (!img) {
          break;
        }
        if (!a.data || a.data.length === 0) {
          i += 1;
          continue;
        }
        group.push({ data: a.data, mimeType: a.mimeType || 'image/png' });
        i += 1;
      }
      if (group.length > 0) {
        const parts = await resolveInboundImageContentParts({
          modelRef: modelRef || getDefaultModelSync(config),
          cfg: config,
          userTextForContext: content.trim() ? content : '',
          images: group,
        });
        messageContent.push(...parts);
      }
    } else {
      const fileBlock = formatInboundFileTextBlock(att, storageRoot);
      messageContent.push({ type: 'text', text: fileBlock });
      i += 1;
    }
  }

  return messageContent;
}
