import { Type } from '@sinclair/typebox';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

import { createDesktopPetPackage } from '../../pets/factory.js';
import type { AgentToolWithMetadata } from './metadata.js';

const DesktopPetPersonaSchema = Type.Object({
  tone: Type.Union([
    Type.Literal('calm'),
    Type.Literal('warm'),
    Type.Literal('playful'),
    Type.Literal('focused'),
  ]),
  warmth: Type.Number({ minimum: 0, maximum: 1 }),
  energy: Type.Number({ minimum: 0, maximum: 1 }),
  humor: Type.Number({ minimum: 0, maximum: 1 }),
  phrases: Type.Optional(Type.Object({
    greeting: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 8 })),
    success: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 8 })),
    waiting: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 8 })),
    error: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 8 })),
  })),
});

const DesktopPetCreateSchema = Type.Object({
  mode: Type.Optional(
    Type.Union([Type.Literal('create'), Type.Literal('update')], {
      description:
        'create installs a new pet package. update overwrites an existing custom pet package identified by petId.',
    }),
  ),
  petId: Type.Optional(
    Type.String({
      description:
        'Existing custom pet id to update. Accepts either "custom:<id>" from Settings or the folder id under ~/.xopc/pets.',
    }),
  ),
  prompt: Type.String({
    description:
      'Full description of the desired pet character, visual style, personality, colors, motifs, and requested changes.',
  }),
  name: Type.Optional(Type.String({ description: 'Optional display name for the pet.' })),
  description: Type.Optional(Type.String({ description: 'Optional short description shown in Settings.' })),
  persona: Type.Optional(DesktopPetPersonaSchema),
  overwrite: Type.Optional(
    Type.Boolean({
      description:
        'When true, reuse the folder derived from the pet name. Default false creates a unique folder if one exists.',
    }),
  ),
});

export type DesktopPetCreateDetails =
  | {
      ok: true;
      id: string;
      name: string;
      dir: string;
      manifestPath: string;
      thumbnailPath: string;
      spritesheetPath: string;
      mode: 'create' | 'update';
    }
  | {
      ok: false;
      error: string;
    };

export function createDesktopPetTool(): AgentToolWithMetadata<typeof DesktopPetCreateSchema, DesktopPetCreateDetails> {
  return {
    name: 'create_desktop_pet',
    label: 'Create Pet',
    description:
      'Create or update a custom animated desktop pet from a natural-language description. Packages are written under ~/.xopc/pets and can be selected in Settings > Pet. Use mode=update with petId when iterating on an existing custom pet.',
    parameters: DesktopPetCreateSchema,
    mutatesWorkspace: false,
    mutationScope: 'external',
    supportsParallel: false,
    idempotent: false,
    requiresExclusiveWorkspaceLock: false,
    finalGuardRelevant: false,
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<AgentToolResult<DesktopPetCreateDetails>> {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
      if (!prompt) {
        return {
          content: [{ type: 'text', text: 'prompt is required.' }],
          details: { ok: false, error: 'prompt is required' },
        };
      }
      const mode = params.mode === 'update' ? 'update' : 'create';
      const petId = typeof params.petId === 'string' ? params.petId.trim() : '';
      if (mode === 'update' && !petId) {
        return {
          content: [{ type: 'text', text: 'petId is required when mode is update.' }],
          details: { ok: false, error: 'petId is required when mode is update' },
        };
      }

      try {
        const result = await createDesktopPetPackage({
          ...(mode === 'update' ? { id: petId } : {}),
          prompt,
          ...(typeof params.name === 'string' && params.name.trim() ? { name: params.name.trim() } : {}),
          ...(typeof params.description === 'string' && params.description.trim()
            ? { description: params.description.trim() }
            : {}),
          ...(params.persona && typeof params.persona === 'object'
            ? { persona: params.persona as Parameters<typeof createDesktopPetPackage>[0]['persona'] }
            : {}),
          overwrite: mode === 'update' ? true : params.overwrite === true,
        });
        return {
          content: [
            {
              type: 'text',
              text: [
                `${mode === 'update' ? 'Updated' : 'Created'} desktop pet "${result.name}".`,
                `Installed at: ${result.dir}`,
                'Open Settings > Pet, refresh if needed, and select the new custom pet.',
              ].join('\n'),
            },
          ],
          details: { ok: true, mode, ...result },
        };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Failed to create desktop pet: ${error}` }],
          details: { ok: false, error },
        };
      }
    },
  };
}
