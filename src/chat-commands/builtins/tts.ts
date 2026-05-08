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
import type { TTSAutoMode, TTSProvider } from '../../voice/tts/types.js';
import {
  appendTtsReadinessNote,
  formatTtsSetupHint,
  isTTSAvailable,
  mergeTtsConfigFromAppConfig,
} from '../../voice/tts/index.js';
import { ttsStatusTracker } from '../../voice/tts/status-tracker.js';

function defaultTtsVoiceForProvider(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'alloy';
    case 'alibaba':
      return 'Cherry';
    case 'edge':
      return 'en-US-MichelleNeural';
    case 'minimax':
      return 'male-qn-qingse';
    default:
      return 'alloy';
  }
}

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
    '/tts provider minimax',
    '/tts voice alloy',
    '/tts status',
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const config = ctx.getConfig?.();
    const ttsConfig = config?.messages?.tts;

    // Get current TTS status
    const isEnabled = ttsConfig?.enabled ?? false;
    const currentTrigger = ttsConfig?.trigger ?? 'off';
    const currentProvider = ttsConfig?.provider ?? 'openai';
    const voicePack = ttsConfig as
      | {
          openai?: { voice?: string };
          alibaba?: { voice?: string };
          edge?: { voice?: string };
          minimax?: { voice?: string };
        }
      | undefined;
    const currentVoice =
      (currentProvider === 'openai'
        ? voicePack?.openai?.voice
        : currentProvider === 'alibaba'
          ? voicePack?.alibaba?.voice
          : currentProvider === 'edge'
            ? voicePack?.edge?.voice
            : currentProvider === 'minimax'
              ? voicePack?.minimax?.voice
              : undefined) ?? defaultTtsVoiceForProvider(currentProvider);

    const effectiveTts = mergeTtsConfigFromAppConfig(ttsConfig);
    const ttsRuntimeOk = isTTSAvailable(effectiveTts);

    // Parse arguments
    const arg = args.trim().toLowerCase();

    const formatTimeAgo = (timestamp: number): string => {
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 60) return `${seconds}s ago`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
      return `${Math.floor(seconds / 86400)}d ago`;
    };

    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    };

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

      const runtimeLine =
        !isEnabled
          ? ''
          : ttsRuntimeOk
            ? `Runtime: ✅ *Ready* (audio can be generated)
`
            : `Runtime: ⚠️ *Not ready* — no provider can run with current config
`;

      const setupHint =
        isEnabled && !ttsRuntimeOk ? `\n${formatTtsSetupHint()}\n` : ''

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
          (runtimeLine ? `\n${runtimeLine}` : '') +
          setupHint +
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
          `/tts status - Runtime TTS diagnostics (last call + stats)
` +
          `/tts provider <openai|alibaba|minimax|edge> - Set provider
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
        const base = success
          ? '✅ TTS enabled. Use `/tts always` or `/tts inbound` to set trigger mode.'
          : '❌ Failed to enable TTS.';
        return {
          content: success ? appendTtsReadinessNote(base, ctx.getConfig?.()) : base,
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
        const base = success
          ? `✅ TTS trigger mode set to *${mode}*${!isEnabled ? ' and TTS enabled' : ''}.`
          : `❌ Failed to set TTS trigger mode.`;
        return {
          content: success ? appendTtsReadinessNote(base, ctx.getConfig?.()) : base,
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

      case 'status': {
        const status = ttsStatusTracker.getStatus();
        const lines: string[] = ['📊 *TTS Status*', ''];

        if (status.lastAttempt) {
          const last = status.lastAttempt;
          const timeAgo = formatTimeAgo(last.timestamp);
          const statusIcon = last.success ? '✅' : '❌';

          lines.push(`*Last attempt*: ${statusIcon} ${timeAgo}`);

          if (last.success) {
            lines.push(`  Provider: ${last.provider ?? '—'}`);
            lines.push(`  Latency: ${last.latencyMs ?? '—'}ms`);
            lines.push(
              `  Text: ${last.textLength ?? '—'} chars → Audio: ${formatBytes(last.audioSize || 0)}`,
            );
            if (last.usedFallback) lines.push(`  ⚠️ Used fallback provider`);
            if (last.wasSummarized) lines.push(`  📝 Text was summarized`);
          } else {
            lines.push(`  Error: ${last.error ?? '—'}`);
            if (last.provider) lines.push(`  Provider: ${last.provider}`);
            lines.push(`  Latency: ${last.latencyMs ?? '—'}ms`);
          }
        } else {
          lines.push('No TTS calls recorded yet.');
        }

        lines.push('');
        lines.push(
          `*Statistics*: ${status.totalCalls} calls, ${status.totalSuccesses} success, ${status.totalFailures} failed`,
        );

        if (status.recentSuccessRate !== undefined && status.totalCalls > 0) {
          const rate = (status.recentSuccessRate * 100).toFixed(0);
          const window = Math.min(status.totalCalls, 20);
          lines.push(`*Recent success rate*: ${rate}% (last ${window} calls)`);
        }

        return {
          content: lines.join('\n'),
          success: true,
        };
      }

      default: {
        // Check for provider or voice subcommand with args
        const parts = arg.split(/\s+/);
        const subcommand = parts[0];
        const subarg = parts[1];

        if (subcommand === 'provider' && subarg) {
          const provider = subarg as TTSProvider;
          if (!['openai', 'alibaba', 'minimax', 'edge'].includes(provider)) {
            return {
              content: `❌ Invalid provider: ${provider}\nValid providers: openai, alibaba, minimax, edge`,
              success: false,
            };
          }
          const success = await ctx.updateConfig?.('tts.provider', provider);
          const base = success
            ? `✅ TTS provider set to *${provider}*.`
            : '❌ Failed to set TTS provider.';
          return {
            content: success ? appendTtsReadinessNote(base, ctx.getConfig?.()) : base,
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
