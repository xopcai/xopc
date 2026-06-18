import { existsSync } from 'node:fs';

import { collectPairingPendingIssues } from '../../../../channels/pairing/pairing-service.js';
import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

function hasEnabledChannel(cfg: Config): boolean {
  return Object.values(cfg.channels ?? {}).some((value) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { enabled?: unknown }).enabled === true;
  });
}

export async function checkChannelPairingPending(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'channel-pairing-pending',
      label: 'Channel pairing',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let cfg: Config;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'channel-pairing-pending',
      label: 'Channel pairing',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  if (!hasEnabledChannel(cfg)) {
    return {
      id: 'channel-pairing-pending',
      label: 'Channel pairing',
      status: 'skip',
      message: 'No channels enabled; skipped.',
      hints: [],
    };
  }

  const issues = collectPairingPendingIssues(cfg);
  if (issues.length === 0) {
    return {
      id: 'channel-pairing-pending',
      label: 'Channel pairing',
      status: 'pass',
      message: 'No pending DM pairing requests.',
      hints: [],
    };
  }

  const totalPending = issues.reduce((n, i) => n + i.pending, 0);
  const totalStale = issues.reduce((n, i) => n + i.stale, 0);
  const atCapacity = issues.filter((i) => i.atCapacity);

  const parts: string[] = [
    `${totalPending} pending pairing request(s) across enabled channels.`,
  ];
  if (totalStale > 0) {
    parts.push(`${totalStale} pending over 30 minutes (codes expire after 1 hour).`);
  }
  if (atCapacity.length > 0) {
    parts.push(
      `${atCapacity.length} account(s) at the pending limit — approve or wait for expiry before new users can request codes.`,
    );
  }

  const hints = [
    'Approve in the gateway console under Settings → Channels, or run: xopc channels pairing approve <id> <CODE>',
  ];
  if (totalStale > 0) {
    hints.push('Stale requests may expire soon; ask users to send a fresh DM if approval fails.');
  }

  return {
    id: 'channel-pairing-pending',
    label: 'Channel pairing',
    status: 'warn',
    message: parts.join(' '),
    hints,
  };
}
