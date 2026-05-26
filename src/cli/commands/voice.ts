/**
 * `xopc voice` — configure text-to-speech (TTS) for outbound messages.
 *
 * Backed by `cfg.messages.tts` per `TTSConfigSchema`. Uses the M1 setup-shared
 * runner so every action emits the same `SetupOutcome` JSON consumed by M2
 * skills and the M3 WebUI.
 */

import { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';
import { resolveConfigPath } from '../../config/paths.js';
import type { Config } from '../../config/schema.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';

import {
  emitOutcome,
  registerSetupDomain,
  registerSetupHandler,
  runSetup,
  runSetupHeadless,
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
    .option('--json', 'Emit a single JSON outcome line', false)
    .action(
      async (
        opts: { provider?: string; trigger?: string; dryRun?: boolean; json?: boolean },
        command: Command,
      ) => {
        const provider = opts.provider as TTSProvider | undefined;
        const trigger = opts.trigger as TTSTrigger | undefined;
        if (provider && !TTS_PROVIDERS.includes(provider)) {
          emitOutcome(
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
          emitOutcome(
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
    .option('--json', 'Emit a single JSON outcome line', false)
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

// HTTP / programmatic handlers for `POST /api/setup/voice/<action>`.
// `fields` shape mirrors the CLI flags (provider / trigger).

function asTtsProvider(value: unknown): TTSProvider | undefined {
  return typeof value === 'string' && (TTS_PROVIDERS as readonly string[]).includes(value)
    ? (value as TTSProvider)
    : undefined;
}

function asTtsTrigger(value: unknown): TTSTrigger | undefined {
  return typeof value === 'string' && (TTS_TRIGGERS as readonly string[]).includes(value)
    ? (value as TTSTrigger)
    : undefined;
}

registerSetupHandler({
  domain: 'voice',
  action: 'enable',
  handler: async ({ configPath, fields, options }) => {
    const provider = asTtsProvider(fields.provider);
    const trigger = asTtsTrigger(fields.trigger);
    return runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'voice',
        action: 'set',
        mutate: (cfg) => applyTTSEnable(cfg, { enabled: true, provider, trigger }),
        resultValue: (cfg) => readTTSStatus(cfg),
      },
    });
  },
});

registerSetupHandler({
  domain: 'voice',
  action: 'disable',
  handler: async ({ configPath, options }) =>
    runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'voice',
        action: 'set',
        mutate: (cfg) => applyTTSEnable(cfg, { enabled: false }),
        resultValue: (cfg) => readTTSStatus(cfg),
      },
    }),
});

/**
 * Full STT+TTS configuration write — used by the web Voice settings panel.
 * Accepts the entire `{ stt, tts }` state blob and merges it into config,
 * providing the same zod validation + diff semantics as the CLI `enable/disable`
 * handlers but covering all sub-fields (provider-specific models, voices, etc.).
 */
registerSetupHandler({
  domain: 'voice',
  action: 'configure',
  handler: async ({ configPath, fields, options }) => {
    const stt = fields.stt && typeof fields.stt === 'object' ? fields.stt : undefined;
    const tts = fields.tts && typeof fields.tts === 'object' ? fields.tts : undefined;
    if (!stt && !tts) {
      return {
        ok: false,
        action: 'set',
        domain: 'voice',
        changedPaths: [],
        dryRun: options.dryRun,
        errors: [{ message: 'At least one of `stt` or `tts` fields is required.' }],
      };
    }
    return runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'voice',
        action: 'set',
        mutate(cfg) {
          const patched = { ...cfg } as Record<string, unknown>;
          if (stt) patched.stt = stt;
          if (tts) patched.tts = tts;
          return patched as Config;
        },
        resultValue: (cfg) => ({
          stt: (cfg as Record<string, unknown>).stt,
          tts: (cfg as Record<string, unknown>).tts,
        }),
      },
    });
  },
});

registerSetupDomain({
  domain: 'voice',
  description: 'Text-to-speech (TTS) for outbound messages.',
  docs: 'https://xopcai.github.io/xopc/voice',
  storage: 'cfg.messages.tts in ~/.xopc/xopc.json',
  actions: [
    {
      name: 'status',
      cli: 'xopc voice status [--json]',
      description: 'Show current TTS configuration.',
    },
    {
      name: 'enable',
      cli: 'xopc voice enable [--provider <id>] [--trigger <mode>] [--dry-run] [--json]',
      description: 'Enable TTS, optionally setting provider/trigger.',
      fields: ['provider', 'trigger'],
    },
    {
      name: 'disable',
      cli: 'xopc voice disable [--dry-run] [--json]',
      description: 'Disable TTS.',
    },
    {
      name: 'configure',
      cli: 'POST /api/setup/voice/configure',
      description: 'Full STT+TTS configuration write (used by web panel). Fields: { stt, tts }.',
      fields: ['stt', 'tts'],
    },
    {
      name: 'schema',
      cli: 'xopc voice schema [--json]',
      description: 'Print TTS setup schema.',
    },
  ],
  fields: {
    provider: {
      type: 'enum',
      description: 'TTS provider engine.',
      enum: [...TTS_PROVIDERS],
      default: 'openai',
    },
    trigger: {
      type: 'enum',
      description: 'When to speak: off (never), always, inbound (only on incoming), tagged (only when message is tagged).',
      enum: [...TTS_TRIGGERS],
      default: 'always',
    },
  },
});
