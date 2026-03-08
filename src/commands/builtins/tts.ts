/**
 * TTS Commands
 *
 * Built-in commands for TTS management:
 * - /tts - Show TTS status
 * - /tts on - Enable TTS
 * - /tts off - Disable TTS
 * - /tts always - Set trigger mode to always
 * - /tts inbound - Set trigger mode to inbound
 * - /tts tagged - Set trigger mode to tagged
 * - /tts never - Set trigger mode to off
 * - /tts provider <provider> - Set TTS provider
 * - /tts voice <voice> - Set TTS voice
 */

import type { CommandDefinition, CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';
import type { TTSAutoMode, TTSProvider } from '../../tts/types.js';

const ttsCommand: CommandDefinition = {
  id: 'tts.manage',
  name: 'tts',
  description: 'Manage TTS (Text-to-Speech) settings',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: [
    '/tts',
    '/tts on',
    '/tts off',
    '/tts always',
    '/tts inbound',
    '/tts tagged',
    '/tts provider openai',
    '/tts voice alloy',
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const config = ctx.getConfig?.();
    const ttsConfig = config?.tts;

    // Get current TTS status
    const isEnabled = ttsConfig?.enabled ?? false;
    const currentTrigger = ttsConfig?.trigger ?? 'off';
    const currentProvider = ttsConfig?.provider ?? 'openai';
    const currentVoice =
      ttsConfig?.[currentProvider]?.voice ??
      (currentProvider === 'openai' ? 'alloy' : 'Cherry');

    // Parse arguments
    const arg = args.trim().toLowerCase();

    if (!arg) {
      // Show current status
      const triggerLabels: Record<string, string> = {
        off: 'Off',
        always: 'Always',
        inbound: 'Inbound',
        tagged: 'Tagged',
      };

      const status = isEnabled ? '✅ Enabled' : '❌ Disabled';
      const trigger = triggerLabels[currentTrigger] ?? currentTrigger;

      return {
        content:
          `🔊 *TTS Settings*

` +
          `Status: ${status}
` +
          `Trigger Mode: *${trigger}*
` +
          `Provider: *${currentProvider}*
` +
          `Voice: *${currentVoice}*

` +
          `*Commands:*
` +
          `/tts on - Enable TTS
` +
          `/tts off - Disable TTS
` +
          `/tts always - Always use TTS
` +
          `/tts inbound - Only reply to voice with voice
` +
          `/tts tagged - Only use TTS with [[tts]] directive
` +
          `/tts provider <openai|alibaba|edge> - Set provider
` +
          `/tts voice <voice-id> - Set voice`,
        success: true,
      };
    }

    // Handle subcommands
    switch (arg) {
      case 'on':
      case 'enable': {
        const success = await ctx.updateConfig?.('tts.enabled', true);
        return {
          content: success
            ? '✅ TTS enabled. Use `/tts always` or `/tts inbound` to set trigger mode.'
            : '❌ Failed to enable TTS.',
          success: !!success,
        };
      }

      case 'off':
      case 'disable': {
        const success = await ctx.updateConfig?.('tts.enabled', false);
        return {
          content: success
            ? '✅ TTS disabled.'
            : '❌ Failed to disable TTS.',
          success: !!success,
        };
      }

      case 'always':
      case 'inbound':
      case 'tagged': {
        const mode = arg as TTSAutoMode;
        const success = await ctx.updateConfig?.('tts.trigger', mode);
        if (success && !isEnabled) {
          // Also enable TTS if setting a trigger mode
          await ctx.updateConfig?.('tts.enabled', true);
        }
        return {
          content: success
            ? `✅ TTS trigger mode set to *${mode}*${!isEnabled ? ' and TTS enabled' : ''}.`
            : `❌ Failed to set TTS trigger mode.`,
          success: !!success,
        };
      }

      case 'never': {
        const success = await ctx.updateConfig?.('tts.trigger', 'off');
        return {
          content: success
            ? '✅ TTS trigger mode set to *off*.'
            : '❌ Failed to set TTS trigger mode.',
          success: !!success,
        };
      }

      default: {
        // Check for provider or voice subcommand with args
        const parts = arg.split(/\s+/);
        const subcommand = parts[0];
        const subarg = parts[1];

        if (subcommand === 'provider' && subarg) {
          const provider = subarg as TTSProvider;
          if (!['openai', 'alibaba', 'edge'].includes(provider)) {
            return {
              content: `❌ Invalid provider: ${provider}\nValid providers: openai, alibaba, edge`,
              success: false,
            };
          }
          const success = await ctx.updateConfig?.('tts.provider', provider);
          return {
            content: success
              ? `✅ TTS provider set to *${provider}*.`
              : '❌ Failed to set TTS provider.',
            success: !!success,
          };
        }

        if (subcommand === 'voice' && subarg) {
          const voice = subarg;
          const provider = currentProvider;
          const success = await ctx.updateConfig?.(`tts.${provider}.voice`, voice);
          return {
            content: success
              ? `✅ TTS voice set to *${voice}* for ${provider}.`
              : '❌ Failed to set TTS voice.',
            success: !!success,
          };
        }

        return {
          content: `❌ Unknown TTS command: ${arg}\n\nUse /tts to see available commands.`,
          success: false,
        };
      }
    }
  },
};

// Register TTS commands
export function registerTTSCommands(): void {
  commandRegistry.register(ttsCommand);
}
