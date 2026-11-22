import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';
import {
  appendProductDeliveryText,
  PRODUCT_DELIVERY_VERSION,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

import {
  isManagedSetupScene,
  type SelfConfigChangeReceipt,
  type SelfConfigDomain,
  type SelfConfigService,
  type UnifiedSetupSceneService,
} from '../../self-config/index.js';

const PersonalSelfConfigSchema = Type.Object({
  command: Type.Union([
    Type.Literal('inspect'),
    Type.Literal('update_profile'),
    Type.Literal('set_avatar'),
    Type.Literal('delete_avatar'),
    Type.Literal('rollback'),
    Type.Literal('start_setup'),
    Type.Literal('check_setup'),
  ]),
  domain: Type.Optional(Type.Union([
    Type.Literal('all'),
    Type.Literal('models'),
    Type.Literal('voice'),
    Type.Literal('web_search'),
    Type.Literal('channels'),
    Type.Literal('browser'),
    Type.Literal('phone'),
    Type.Literal('computer'),
    Type.Literal('profile'),
    Type.Literal('appearance'),
    Type.Literal('compaction'),
  ])),
  target: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('personal_agent')])),
  source: Type.Optional(Type.String({ description: 'media:// URI or workspace/state image path for set_avatar.' })),
  preset: Type.Optional(Type.String({ description: 'Personal AI preset appearance: loopi, loopi-curious, or loopi-care.' })),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
  appearance: Type.Optional(Type.Union([
    Type.Literal('loopi'),
    Type.Literal('loopi-curious'),
    Type.Literal('loopi-care'),
  ])),
  messageReactionsEnabled: Type.Optional(Type.Boolean()),
  voicePreference: Type.Optional(Type.Union([
    Type.Null(),
    Type.Object({
      provider: Type.String({ minLength: 1, maxLength: 100 }),
      model: Type.String({ minLength: 1, maxLength: 200 }),
      voice: Type.String({ minLength: 1, maxLength: 200 }),
    }),
  ])),
  changeId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  scene: Type.Optional(Type.Union([
    Type.Literal('models'),
    Type.Literal('web_search'),
    Type.Literal('voice'),
    Type.Literal('channels'),
    Type.Literal('computer'),
  ])),
  setupId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  resumeObjective: Type.Optional(Type.String({ maxLength: 400 })),
  dryRun: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

type Input = Static<typeof PersonalSelfConfigSchema>;

export interface PersonalSelfConfigToolDeps {
  getSelfConfigService?: () => SelfConfigService | undefined;
  getSetupSceneService?: () => UnifiedSetupSceneService | undefined;
  getCurrentConversationId?: () => string | undefined;
  getCurrentAgentId?: () => string | undefined;
  canConfigureFromConversation?: () => boolean;
}

export function deliveryForSelfConfigReceipt(
  receipt: SelfConfigChangeReceipt | undefined,
): ProductDeliveryEnvelope | undefined {
  if (!receipt) return undefined;
  return {
    version: PRODUCT_DELIVERY_VERSION,
    operation: 'updated',
    primary: {
      kind: 'settings',
      id: receipt.settingsSection,
      title: receipt.title,
      summary: receipt.summary,
      capabilities: receipt.canRollback ? ['open', 'rollback'] : ['open'],
    },
    presentation: {
      kind: 'config_change',
      changeId: receipt.changeId,
      tier: receipt.tier,
      target: receipt.target,
      title: receipt.title,
      canRollback: receipt.canRollback,
      changes: receipt.changes.slice(0, 20),
    },
  };
}

function okResult(payload: Record<string, unknown>, delivery?: ProductDeliveryEnvelope): AgentToolResult<Record<string, unknown>> {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text: appendProductDeliveryText(text, delivery) }],
    details: { ...payload, ...(delivery ? { delivery } : {}) },
  };
}

function errorResult(message: string): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    details: { ok: false, error: message },
  };
}

export function createPersonalSelfConfigTool(deps: PersonalSelfConfigToolDeps): AgentTool {
  return {
    name: 'personal_self_config',
    label: 'Personal self-configuration',
    description:
      'Inspect xopc readiness, customize your own Personal AI profile (displayName, appearance, voicePreference, messageReactionsEnabled), ' +
      'set or remove user or Personal AI avatars from media:// attachments or generated images, roll back recent changes, ' +
      'or start guided setup scenes (models, web_search, voice, channels, computer) when configuration or secrets are needed. ' +
      'Never ask users to type API keys or tokens in chat; return the secure interactionPath from start_setup.',
    parameters: PersonalSelfConfigSchema,
    async execute(_toolCallId: string, raw: unknown): Promise<AgentToolResult<Record<string, unknown>>> {
      const input = raw as Input;
      const selfConfig = deps.getSelfConfigService?.();
      if (!selfConfig) {
        return errorResult('Self-configuration service is unavailable in this runtime.');
      }
      const conversationId = deps.getCurrentConversationId?.();
      const agentId = deps.getCurrentAgentId?.() ?? 'main';
      const canConfigure = deps.canConfigureFromConversation?.() === true;

      try {
        if (['update_profile', 'set_avatar', 'delete_avatar', 'rollback'].includes(input.command)
          && (!input.dryRun || input.command === 'rollback') && !canConfigure) {
          return errorResult('Continue in an authorized interactive conversation to change settings.');
        }
        if (input.command === 'inspect') {
          const result = await selfConfig.inspect((input.domain ?? 'all') as SelfConfigDomain);
          return okResult(result as unknown as Record<string, unknown>);
        }

        if (input.command === 'update_profile') {
          const patch: Record<string, unknown> = {};
          if (input.displayName !== undefined) patch.displayName = input.displayName;
          if (input.appearance !== undefined) patch.appearance = input.appearance;
          if (input.messageReactionsEnabled !== undefined) patch.messageReactionsEnabled = input.messageReactionsEnabled;
          if (input.voicePreference !== undefined) patch.voicePreference = input.voicePreference;
          if (Object.keys(patch).length === 0) {
            return errorResult('Provide at least one profile field: displayName, appearance, voicePreference, or messageReactionsEnabled.');
          }
          const result = await selfConfig.patch({
            target: 'personal_agent.profile',
            patch,
            dryRun: input.dryRun === true,
            conversationId,
          });
          if (!result.ok) return errorResult(result.error ?? 'Failed to update Personal AI profile.');
          return okResult(
            result as unknown as Record<string, unknown>,
            input.dryRun ? undefined : deliveryForSelfConfigReceipt(result.receipt),
          );
        }

        if (input.command === 'set_avatar') {
          const target = input.target ?? 'personal_agent';
          const result = await selfConfig.setAvatar(
            {
              target,
              ...(input.source ? { source: input.source } : {}),
              ...(input.preset ? { preset: input.preset } : {}),
            },
            { conversationId, dryRun: input.dryRun === true },
          );
          if (!result.ok) return errorResult(result.error ?? 'Failed to set avatar.');
          return okResult(
            result as unknown as Record<string, unknown>,
            input.dryRun ? undefined : deliveryForSelfConfigReceipt(result.receipt),
          );
        }

        if (input.command === 'delete_avatar') {
          const target = input.target ?? 'personal_agent';
          const result = await selfConfig.deleteAvatar(
            { target },
            { conversationId, dryRun: input.dryRun === true },
          );
          if (!result.ok) return errorResult(result.error ?? 'Failed to delete avatar.');
          return okResult(
            result as unknown as Record<string, unknown>,
            input.dryRun ? undefined : deliveryForSelfConfigReceipt(result.receipt),
          );
        }

        if (input.command === 'rollback') {
          if (!input.changeId) return errorResult('changeId is required for rollback.');
          const result = await selfConfig.rollback(input.changeId);
          if (!result.ok) return errorResult(result.error ?? 'Rollback failed.');
          return okResult(result as unknown as Record<string, unknown>);
        }

        if (input.command === 'start_setup' || input.command === 'check_setup') {
          const setupScenes = deps.getSetupSceneService?.();
          if (!setupScenes || !conversationId) {
            return errorResult('Guided setup requires an active Gateway conversation.');
          }
          if (!input.scene || !isManagedSetupScene(input.scene)) {
            return errorResult('Provide a valid scene: models, web_search, voice, channels, or computer.');
          }
          const cmd = input.command === 'start_setup' ? 'start' : (input.setupId ? 'recheck' : 'inspect');
          const res = await setupScenes.command(
            input.scene,
            cmd,
            {
              ...(input.setupId ? { setupId: input.setupId } : {}),
              ...(input.resumeObjective ? { resumeObjective: input.resumeObjective } : {}),
            },
            { conversationId, agentId, canConfigure },
            input.dryRun === true,
          );
          return okResult(res);
        }

        return errorResult(`Unsupported command: ${String(input.command)}`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  } as AgentTool;
}
