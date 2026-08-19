/**
 * `xopc voice` — configure text-to-speech (TTS) for outbound messages.
 *
 * Backed by `cfg.messages.tts` per `TTSConfigSchema`. Uses the M1 setup-shared
 * runner so every action emits the same `SetupTask` JSON consumed by M2
 * skills and the M3 WebUI.
 */

import { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';
import { resolveConfigPath } from '../../config/paths.js';
import type { Config } from '../../config/schema.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';

import {
  emitTask,
  runSetup,
} from './setup-shared/index.js';

const TTS_PROVIDERS = ['openai', 'alibaba', 'edge', 'minimax'] as const;
type TTSProvider = (typeof TTS_PROVIDERS)[number];

const TTS_TRIGGERS = ['off', 'always', 'inbound', 'tagged'] as const;
type TTSTrigger = (typeof TTS_TRIGGERS)[number];

interface TTSStatusSnapshot {
  enabled: boolean;
  provider: string;
  trigger: string;
  maxTextLength: number;
  timeoutMs: number;
}

export function readTTSStatus(cfg: Config): TTSStatusSnapshot {
  const tts = (cfg.messages?.tts ?? {}) as Record<string, unknown>;
  return {
    enabled: tts.enabled === true,
    provider: typeof tts.provider === 'string' ? tts.provider : 'openai',
    trigger: typeof tts.trigger === 'string' ? tts.trigger : 'always',
    maxTextLength: typeof tts.maxTextLength === 'number' ? tts.maxTextLength : 512,
    timeoutMs: typeof tts.timeoutMs === 'number' ? tts.timeoutMs : 60000,
  };
}

export function applyTTSEnable(
  cfg: Config,
  patch: { enabled?: boolean; provider?: TTSProvider; trigger?: TTSTrigger },
): Config {
  const messages = { ...((cfg.messages ?? {}) as Record<string, unknown>) };
  const tts = { ...((messages.tts ?? {}) as Record<string, unknown>) };
  if (patch.enabled !== undefined) tts.enabled = patch.enabled;
  if (patch.provider !== undefined) tts.provider = patch.provider;
  if (patch.trigger !== undefined) tts.trigger = patch.trigger;
  messages.tts = tts;
  return { ...cfg, messages } as Config;
}

function resolveConfigPathFromCommand(command: Command): string {
  let cur: Command | undefined = command;
  while (cur?.parent) cur = cur.parent;
  const opts = cur?.opts() as { config?: string } | undefined;
  return (
    opts?.config?.trim() ||
    process.env.XOPC_CONFIG_PATH?.trim() ||
    process.env.XOPC_CONFIG?.trim() ||
    resolveConfigPath()
  );
}

function createVoiceCommand(_ctx: CLIContext): Command {
  const cmd = new Command('voice')
    .description('Configure text-to-speech (TTS) output')
    .addHelpText(
      'after',
      formatExamples([
        'xopc voice status',
        'xopc voice status --json',
        'xopc voice enable',
        'xopc voice enable --provider edge --trigger inbound',
        'xopc voice disable',
        'xopc voice schema --json',
      ]),
    );

  cmd
    .command('status')
    .description('Show TTS configuration status')
    .option('--json', 'Output as JSON', false)
    .action((opts: { json?: boolean }, command: Command) => {
      const status = readTTSStatus(loadConfig(resolveConfigPathFromCommand(command)));
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, voice: status }) + '\n');
        return;
      }
      const badge = status.enabled ? colors.green('● enabled') : colors.gray('○ disabled');
      console.log('');
      console.log(colors.bold('VOICE (TTS)'));
      console.log(`  Status:    ${badge}`);
      console.log(`  Provider:  ${status.provider}`);
      console.log(`  Trigger:   ${status.trigger}`);
      console.log(`  Max text:  ${status.maxTextLength}`);
      console.log(`  Timeout:   ${status.timeoutMs}ms`);
      console.log('');
    });

  cmd
    .command('enable')
    .description('Enable TTS (optionally update provider/trigger)')
    .option(
      '--provider <id>',
      `TTS provider: ${TTS_PROVIDERS.join(' | ')}`,
    )
    .option('--trigger <mode>', `Trigger mode: ${TTS_TRIGGERS.join(' | ')}`)
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON task line', false)
    .action(
      async (
        opts: { provider?: string; trigger?: string; dryRun?: boolean; json?: boolean },
        command: Command,
      ) => {
        const provider = opts.provider as TTSProvider | undefined;
        const trigger = opts.trigger as TTSTrigger | undefined;
        if (provider && !TTS_PROVIDERS.includes(provider)) {
          emitTask(
            {
              ok: false,
              action: 'set',
              domain: 'voice',
              changedPaths: [],
              dryRun: Boolean(opts.dryRun),
              errors: [
                {
                  path: 'provider',
                  message: `Unknown provider "${provider}". Use one of: ${TTS_PROVIDERS.join(', ')}.`,
                },
              ],
            },
            Boolean(opts.json),
          );
          process.exitCode = 1;
          return;
        }
        if (trigger && !TTS_TRIGGERS.includes(trigger)) {
          emitTask(
            {
              ok: false,
              action: 'set',
              domain: 'voice',
              changedPaths: [],
              dryRun: Boolean(opts.dryRun),
              errors: [
                {
                  path: 'trigger',
                  message: `Unknown trigger "${trigger}". Use one of: ${TTS_TRIGGERS.join(', ')}.`,
                },
              ],
            },
            Boolean(opts.json),
          );
          process.exitCode = 1;
          return;
        }

        await runSetup({
          configPath: resolveConfigPathFromCommand(command),
          options: { dryRun: Boolean(opts.dryRun), json: Boolean(opts.json) },
          mutator: {
            domain: 'voice',
            action: 'set',
            mutate(cfg) {
              return applyTTSEnable(cfg, { enabled: true, provider, trigger });
            },
            resultValue: (cfg) => readTTSStatus(cfg),
            notes: () => ['TTS enabled. Configure the chosen provider key separately if needed.'],
          },
        });
      },
    );

  cmd
    .command('disable')
    .description('Disable TTS')
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON task line', false)
    .action(async (opts: { dryRun?: boolean; json?: boolean }, command: Command) => {
      await runSetup({
        configPath: resolveConfigPathFromCommand(command) || undefined!,
        options: { dryRun: Boolean(opts.dryRun), json: Boolean(opts.json) },
        mutator: {
          domain: 'voice',
          action: 'set',
          mutate(cfg) {
            return applyTTSEnable(cfg, { enabled: false });
          },
          resultValue: (cfg) => readTTSStatus(cfg),
        },
      });
    });

  cmd
    .command('schema')
    .description('Print voice/TTS setup schema for agents/UIs')
    .option('--json', 'JSON output (default human-readable JSON)', false)
    .action((opts: { json?: boolean }) => {
      const payload = {
        ok: true,
        schema: {
          target: 'cfg.messages.tts',
          fields: {
            enabled: { type: 'boolean', default: false },
            provider: { type: 'enum', enum: [...TTS_PROVIDERS], default: 'openai' },
            trigger: { type: 'enum', enum: [...TTS_TRIGGERS], default: 'always' },
            maxTextLength: { type: 'number', default: 512 },
            timeoutMs: { type: 'number', default: 60000 },
          },
        },
      };
      if (opts.json) process.stdout.write(JSON.stringify(payload) + '\n');
      else console.log(JSON.stringify(payload, null, 2));
    });

  return cmd;
}

register({
  id: 'voice',
  name: 'voice',
  description: 'Configure TTS (text-to-speech) output',
  factory: createVoiceCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc voice status',
      'xopc voice enable --provider edge --trigger inbound',
      'xopc voice disable',
      'xopc voice schema --json',
    ],
  },
});
