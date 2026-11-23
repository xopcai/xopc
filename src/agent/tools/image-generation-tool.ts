import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import {
  configuredImageGenerationModelRef,
  enqueueImageJob,
  getImageJob,
  listImageJobs,
  publicImageJob,
} from '../../image-generation/repository.js';
import { getCurrentTranscriptId } from '../../storage/sqlite/session-repository.js';

const schema = Type.Object({
  action: Type.Union([Type.Literal('generate'), Type.Literal('inspect')]),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Short descriptive title for the image card.' })),
  prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 4000, description: 'Detailed visual prompt describing the image to generate or the edits to apply.' })),
  aspectRatio: Type.Optional(Type.String({ maxLength: 20, description: 'Optional aspect ratio, e.g. 1:1, 16:9, 9:16, 4:3.' })),
  resolution: Type.Optional(Type.Union([Type.Literal('1K'), Type.Literal('2K'), Type.Literal('4K')])),
  quality: Type.Optional(Type.Union([
    Type.Literal('low'),
    Type.Literal('medium'),
    Type.Literal('high'),
    Type.Literal('xhigh'),
    Type.Literal('max'),
    Type.Literal('auto'),
  ])),
  outputFormat: Type.Optional(Type.Union([Type.Literal('png'), Type.Literal('jpeg'), Type.Literal('webp')])),
  background: Type.Optional(Type.Union([Type.Literal('transparent'), Type.Literal('opaque'), Type.Literal('auto')])),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 4, description: 'Number of images to generate (1–4, default 1).' })),
  parentId: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$', description: 'Completed image job ID in this chat to revise or iterate on.' })),
  imageUri: Type.Optional(Type.String({ maxLength: 512, description: 'Optional uploaded media:// URI to use as reference image for editing.' })),
}, { additionalProperties: false });

type ImageGenerationToolInput = Static<typeof schema>;

export interface ImageGenerationToolDeps {
  getConversationId: () => string | undefined;
  getConfig: () => Config | undefined;
  getAgentId: () => string | undefined;
}

export function createImageGenerationTool(deps: ImageGenerationToolDeps): AgentTool<typeof schema> {
  return {
    name: 'image_generation',
    label: 'Generate image',
    description:
      'Generate or revise images asynchronously as a chat card, or inspect existing image requests in this chat. '
      + 'Call generate only when the user asks to create or edit an image. '
      + 'For a new image provide a short title and a clear visual prompt; omit optional parameters unless requested. '
      + 'For revisions of a previously generated image in this chat, inspect completed versions and pass parentId with the updated prompt. '
      + 'For editing an uploaded image, pass its media:// URI in imageUri. '
      + 'Each call enqueues one job immediately and returns without waiting; do not repeat generation to poll progress. '
      + 'Use inspect to check status or prior prompts, and tell the user the image will appear in the chat card once ready.',
    parameters: schema,
    async execute(toolCallId, params: ImageGenerationToolInput, signal) {
      signal?.throwIfAborted();
      const conversationId = deps.getConversationId();
      if (!conversationId) throw new Error('Image generation is available in Web chat.');
      const transcriptId = getCurrentTranscriptId(conversationId);
      if (!transcriptId) throw new Error('The current chat is unavailable.');

      const cfg = deps.getConfig();
      const agentId = deps.getAgentId();
      const { action, ...request } = params;

      if (action === 'inspect') {
        const modelRef = configuredImageGenerationModelRef(cfg, agentId);
        const selected = request.parentId ? getImageJob(conversationId, request.parentId) : undefined;
        const result = request.parentId
          ? { job: selected?.transcript_id === transcriptId ? publicImageJob(selected) : null }
          : {
              configured: Boolean(modelRef),
              modelRef,
              jobs: listImageJobs(conversationId, transcriptId).slice(0, 12),
            };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      }

      const result = enqueueImageJob(conversationId, transcriptId, toolCallId, {
        ...request,
        agentId,
      }, cfg);
      const receipt = result.job
        ? { id: result.job.id, workId: result.job.workId, versionNumber: result.job.versionNumber, state: result.job.state }
        : result;
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt };
    },
  };
}
