import { existsSync } from 'node:fs';

import type { CheckResult, DoctorContext } from '../types.js';
import { loadConfig } from '../../../../config/loader.js';
import { listChannelPlugins } from '../../../../channels/plugins/registry.js';
import type { ChannelDoctorCheckResult, ChannelPlugin } from '../../../../channels/plugin-types.js';

function toCheckResults(plugin: ChannelPlugin, raw: ChannelDoctorCheckResult[]): CheckResult[] {
  const pid = String(plugin.id);
  return raw.map((r) => ({
    id: `channel:${pid}:${r.id}`,
    label: `${pid}: ${r.label}`,
    status: r.status,
    message: r.message,
    hints: r.hints,
  }));
}

export async function checkChannelPlugins(ctx: DoctorContext): Promise<CheckResult[]> {
  if (!existsSync(ctx.configPath)) {
    return [];
  }

  let cfg;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return [];
  }

  const out: CheckResult[] = [];
  for (const plugin of listChannelPlugins()) {
    const doctor = plugin.doctor;
    if (!doctor?.check) continue;
    try {
      const res = await doctor.check({ cfg });
      out.push(...toCheckResults(plugin, res));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({
        id: `channel:${plugin.id}:error`,
        label: `${String(plugin.id)}: doctor`,
        status: 'warn',
        message: `Channel doctor check failed: ${msg}`,
        hints: [],
      });
    }
  }
  return out;
}
