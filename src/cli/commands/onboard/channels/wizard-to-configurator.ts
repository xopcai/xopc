/**
 * Bridge declarative {@link ChannelSetupWizard} (from bundled plugins) to {@link ChannelConfigurator}.
 */

import { confirm, input, select } from '@inquirer/prompts';
import type { Config } from '../../../../config/schema.js';
import type { ChannelSetupWizard } from '../../../../channels/plugins/types.adapters.js';
import type { ChannelConfigurator } from './types.js';

function readChannelField(cfg: Config, channel: string, key: string): string | undefined {
  const raw = (cfg.channels as Record<string, unknown> | undefined)?.[channel];
  if (!raw || typeof raw !== 'object') return undefined;
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

function parseAllowlistRaw(raw: string): Array<string | number> {
  if (!raw.trim()) return [];
  const entries = raw
    .split(/[,\s\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return entries.map(e => {
    const num = parseInt(e, 10);
    return !isNaN(num) && String(num) === e ? num : e;
  });
}

function mergeChannel(
  cfg: Config,
  channel: string,
  partial: Record<string, unknown>
): Config {
  const channels = { ...(cfg.channels as Record<string, unknown> | undefined) };
  const prev = (channels[channel] as Record<string, unknown> | undefined) ?? {};
  channels[channel] = { ...prev, ...partial, enabled: true };
  return { ...cfg, channels } as Config;
}

export function channelSetupWizardToConfigurator(
  wizard: ChannelSetupWizard,
  meta: { name: string; description: string }
): ChannelConfigurator {
  const id = wizard.channel;

  return {
    id,
    name: meta.name,
    description: meta.description,

    isConfigured(cfg: Config): boolean {
      const creds = wizard.credentials ?? [];
      if (creds.length === 0) {
        return false;
      }
      return creds.every(c => {
        const v = readChannelField(cfg, id, c.key);
        return typeof v === 'string' && v.trim().length > 0;
      });
    },

    async configure(config: Config): Promise<Config> {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`📱 ${meta.name} setup`);
      console.log(`${'='.repeat(50)}\n`);

      let next = config;
      const values: Record<string, string> = {};

      const env = wizard.envShortcut;
      if (env) {
        const fromEnv = process.env[env.envVar]?.trim();
        if (fromEnv) {
          const use = await confirm({
            message: `${env.envVar} is set in the environment. Use it for this channel?`,
            default: true,
          });
          if (use) {
            const parts = env.configPath.split('.');
            const key = parts[parts.length - 1] ?? 'botToken';
            values[key] = fromEnv;
          }
        }
      }

      for (const c of wizard.credentials) {
        if (values[c.key]) continue;
        const existing = readChannelField(next, id, c.key);
        if (existing) {
          const keep = await confirm({
            message: `Keep existing ${c.label}?`,
            default: true,
          });
          if (keep) {
            values[c.key] = existing;
            continue;
          }
        }
        let v = '';
        while (true) {
          v = await input({
            message: `${c.label}:`,
          });
          const err = c.validate?.(v) ?? null;
          if (!err) break;
          console.log(`⚠️  ${err}`);
        }
        values[c.key] = v.trim();
      }

      const partial: Record<string, unknown> = { ...values };

      if (wizard.dmPolicy) {
        const policy = await select<string>({
          message: 'DM / access policy:',
          choices: wizard.dmPolicy.options.map(o => ({
            value: o.value,
            name: o.label,
            description: o.description,
          })),
          default: wizard.dmPolicy.default,
        });
        partial.dmPolicy = policy;
        if (policy === 'allowlist' && wizard.allowFrom) {
          const raw = await input({
            message: wizard.allowFrom.hint,
            default: '',
          });
          partial.allowFrom = parseAllowlistRaw(raw);
        }
      }

      next = mergeChannel(next, id, partial);

      if (wizard.finalize) {
        const result = await wizard.finalize.validate(next);
        if (!result.ok) {
          console.log(`⚠️  ${result.error ?? 'Validation failed'}`);
          return config;
        }
        console.log(`\n✅ ${wizard.finalize.message}\n`);
      } else {
        console.log('\n✅ Channel configuration saved.\n');
      }

      return next;
    },
  };
}
