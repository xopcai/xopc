/**
 * Model Commands
 *
 * Built-in commands for model management:
 * - /models - List models with display names and `provider/model` refs for /switch
 * - /switch - Switch model using the ref from /models
 * - /usage - Show token usage statistics
 */

import type { CommandDefinition, CommandContext, UIComponent } from '../types.js';
import { commandRegistry } from '../registry.js';
import { bulletList, code, hint, joinBlocks, kvList, section } from '../format-output.js';

const modelsCommand: CommandDefinition = {
  id: 'model.list',
  name: 'models',
  aliases: ['model'],
  description: 'List models with display names and `provider/model` refs for /switch',
  category: 'model',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    await ctx.setTyping(true);

    const models = await ctx.listModels();
    const currentModel = ctx.getCurrentModel();

    if (models.length === 0) {
      return {
        content: '🤖 No models available. Please check your configuration.',
        success: true,
      };
    }

    // Group by provider
    const byProvider = new Map<string, typeof models>();
    for (const m of models) {
      if (!byProvider.has(m.provider)) {
        byProvider.set(m.provider, []);
      }
      byProvider.get(m.provider)!.push(m);
    }

    /** `m.id` from listModels is always `serviceId/modelId` (canonical `/switch` ref). */
    const providerBlocks = Array.from(byProvider.entries()).map(([provider, providerModels]) => {
      const items = providerModels.slice(0, 5).map((m) => {
        const marker = m.id === currentModel ? '▶️ ' : '';
        return `${marker}**${m.name}** — ${code(m.id)}`;
      });
      if (providerModels.length > 5) {
        items.push(hint(`… and ${providerModels.length - 5} more in this provider`));
      }
      return joinBlocks(section(provider), bulletList(items));
    });

    const content = joinBlocks(
      '🤖 Available models (use the `provider/model` ref with `/switch`):',
      ...providerBlocks,
      hint('Copy the ref in backticks after each name, then: `/switch provider/model-id`.'),
    );

    // Create UI component if supported
    if (ctx.supports('buttons')) {
      const component: UIComponent = {
        type: 'model-picker',
        providers: Array.from(byProvider.entries()).map(([id, models]) => ({
          id,
          name: id,
          models: models.map((m) => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
          })),
        })),
        currentModel,
      };

      return {
        content,
        success: true,
        components: [component],
      };
    }

    return {
      content,
      success: true,
    };
  },
};

const switchCommand: CommandDefinition = {
  id: 'model.switch',
  name: 'switch',
  description: 'Switch model — pass the `provider/model` ref shown by /models',
  category: 'model',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/switch openai/gpt-5.5', '/switch minimax/minimax-m2.7'],
  handler: async (ctx: CommandContext, args: string) => {
    if (!args.trim()) {
      return {
        content: joinBlocks(
          '❌ Missing model ref.',
          '**Usage:** `/switch provider/model-id`',
          'Run `/models` — each line shows a display name and a `provider/model` ref in backticks. Copy that ref.',
          '**Example:** `/switch openai/gpt-5.5`',
        ),
        success: false,
      };
    }

    await ctx.setTyping(true);

    const modelId = args.trim();
    const success = await ctx.switchModel(modelId);

    if (success) {
      const modelName = modelId.split('/').pop() || modelId;
      return {
        content: joinBlocks(
          `✅ Switched to ${code(modelId)} (${modelName}).`,
          'This model will be used for your next message.',
        ),
        success: true,
      };
    }

    return {
      content: joinBlocks(
        `❌ Could not switch to ${code(modelId)}.`,
        'Use the exact `provider/model` ref from `/models` (not only the display name).',
        '**Example:** `/switch anthropic/claude-sonnet-4-20250514`',
      ),
      success: false,
    };
  },
};

const usageCommand: CommandDefinition = {
  id: 'model.usage',
  name: 'usage',
  description: 'Show token usage statistics for current session',
  category: 'model',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    await ctx.setTyping(true);

    const stats = await ctx.getUsage();
    const modelName = ctx.getCurrentModel().split('/').pop() || 'Unknown';

    const content = joinBlocks(
      section('📊 Session Token Usage'),
      kvList([
        { key: 'Model', value: modelName },
        { key: 'Prompt', value: `${stats.promptTokens.toLocaleString()} tokens` },
        { key: 'Completion', value: `${stats.completionTokens.toLocaleString()} tokens` },
        { key: 'Total', value: `${stats.totalTokens.toLocaleString()} tokens` },
        { key: 'Messages', value: String(stats.messageCount) },
      ]),
    );

    // Create UI component if supported
    if (ctx.supports('buttons')) {
      const component: UIComponent = {
        type: 'usage-display',
        stats,
        modelName,
      };

      return {
        content,
        success: true,
        components: [component],
      };
    }

    return {
      content,
      success: true,
    };
  },
};

// Register all model commands
export function registerModelCommands(): void {
  commandRegistry.register(modelsCommand);
  commandRegistry.register(switchCommand);
  commandRegistry.register(usageCommand);
}
