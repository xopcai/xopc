import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { getCurrentTranscriptId } from '../../storage/sqlite/session-repository.js';
import { getVideoDraft, prepareVideoDraft, videoDraftImages } from '../../video-generation/drafts.js';
import { getVideoJob } from '../../video-generation/repository.js';

const schema = Type.Object({
  action: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('revise'), Type.Literal('inspect')]),
  prompt: Type.Optional(Type.String({ maxLength: 1000 })),
  summary: Type.Optional(Type.String({ maxLength: 180, description: 'A short description of the visible scene in the user’s language. Keep it in sync whenever the prompt changes.' })),
  duration: Type.Optional(Type.Integer()),
  ratio: Type.Optional(Type.Union([Type.Literal('16:9'), Type.Literal('9:16'), Type.Literal('adaptive')])),
  resolution: Type.Optional(Type.Union([Type.Literal('480P'), Type.Literal('720P'), Type.Literal('1080P')])),
  image: Type.Optional(Type.Union([Type.Literal('current'), Type.Literal('none')])),
  imageUri: Type.Optional(Type.String({ maxLength: 512 })),
});

export function createVideoDraftTool(getConversationId: () => string | undefined): AgentTool<typeof schema> {
  return {
    name: 'video_draft',
    label: 'Prepare video draft',
    description: 'Prepare a video when the user asks to generate one in Web chat. Create a draft, update the pending draft, or revise the last submitted video as a new version. For a new draft, a single image in the current user message is used by default. An update or revision keeps its reference image unless the user requests another one; use image=current to switch to a new attachment. Use inspect to list recent images and the previous draft. Ask which image to use when the reference is ambiguous. Use video settings for any unspecified options. Provide a short scene summary alongside the full prompt. The draft appears as a card. When presenting a new or updated draft, tell the user to confirm using the button on the card, in the language of the reply. For Chinese replies, use “点击卡片上的「确认生成」，或回复「就按这个生成」。” For English replies, also offer “confirm video generation” as a reply. This tool cannot start generation.',
    parameters: schema,
    async execute(_id, args) {
      if (!Value.Check(schema, args)) throw new Error('Invalid video draft parameters.');
      const conversationId = getConversationId();
      if (!conversationId) throw new Error('Video drafts are available in Web chat.');
      if (args.action === 'inspect') {
        const transcriptId = getCurrentTranscriptId(conversationId);
        const draft = transcriptId ? getVideoDraft(conversationId, transcriptId) : undefined;
        const { recent } = videoDraftImages(conversationId);
        return { content: [{ type: 'text', text: JSON.stringify({
          draft, submitted: Boolean(draft && getVideoJob(conversationId, draft.id)),
          images: recent.slice(0, 12).map(({ uri, name }) => ({ uri, name })),
        }) }], details: {} };
      }
      const { action, ...input } = args;
      const draft = prepareVideoDraft(conversationId, { action, ...input });
      return { content: [{ type: 'text', text: JSON.stringify(draft) }], details: {} };
    },
  };
}
