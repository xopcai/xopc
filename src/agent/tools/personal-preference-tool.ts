import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { getPersonalAgentByConversation } from '../../personal-agent/repository.js';
import { PersonalPreferencesSchema, updatePersonalProfileRecord } from '../../personal-agent/service.js';

const PreferenceSchema = Type.Object({
  field: Type.Union([
    Type.Literal('addressAs'), Type.Literal('warmth'), Type.Literal('humor'),
    Type.Literal('supportMode'), Type.Literal('detailLevel'), Type.Literal('proactivity'),
  ]),
  value: Type.String({ description: 'Use the exact enum for the field: warmth=reserved|balanced|gentle; humor=none|occasional|playful; supportMode=listen|untangle|solutions; detailLevel=brief|balanced|detailed; proactivity=decisions|important|open. addressAs is free text. Save only explicitly requested lasting preferences.' }),
});

export function createPersonalPreferenceTool(deps: {
  getCurrentConversationId: () => string | undefined;
  onAgentCatalogMutate?: () => void;
}): AgentTool<typeof PreferenceSchema, Record<string, never>> {
  return {
    name: 'personal_preference',
    label: 'Personal Preference',
    description: 'Save how the user explicitly wants you to respond in future conversations. Do not save guesses, a temporary mood, or a one-time instruction.',
    parameters: PreferenceSchema,
    async execute(_toolCallId, input) {
      const conversationId = deps.getCurrentConversationId();
      const personal = conversationId ? getPersonalAgentByConversation(conversationId) : null;
      if (!personal || personal.state !== 'ready') throw new Error('Personal AI conversation is unavailable');
      const next = PersonalPreferencesSchema.parse({
        ...personal.preferences,
        [input.field]: input.value.trim(),
      });
      const updated = await updatePersonalProfileRecord(personal.ownerId, personal.revision, personal.displayName, next, personal.appearance);
      if (!updated) throw new Error('Preference changed concurrently; read the current profile and try again');
      deps.onAgentCatalogMutate?.();
      return { content: [{ type: 'text', text: `Saved ${input.field} as an explicit preference. It takes effect on the next reply.` }], details: {} };
    },
  };
}
