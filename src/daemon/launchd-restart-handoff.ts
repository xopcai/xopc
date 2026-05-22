/**
 * LaunchAgent Restart Handoff - Detached shell script for reliable restart
 *
 * Avoids the deadlock where launchd restart kills the process that initiated it.
 * Spawns a detached /bin/sh process that:
 * 1. Waits for the current gateway process to exit
 * 2. Executes launchctl kickstart -k (or bootout+bootstrap fallback)
 * 3. Cleans up after itself
 */

import { spawn } from 'node:child_process';
import { createLogger } from '../utils/logger.js';
import { resolveGatewayLaunchAgentLabel, resolveLaunchAgentPlistPath } from './constants.js';

const log = createLogger('LaunchdRestartHandoff');

export type LaunchdRestartHandoffMode = 'kickstart' | 'reload' | 'start-after-exit';

export interface LaunchdRestartHandoffResult {
  ok: boolean;
  pid?: number;
  detail?: string;
}

interface LaunchdRestartTarget {
  domain: string;
  label: string;
  plistPath: string;
  serviceTarget: string;
}

function resolveGuiDomain(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  return `gui/${uid}`;
}

function resolveRestartTarget(env?: Record<string, string | undefined>): LaunchdRestartTarget {
  const profile = env?.XOPC_PROFILE?.trim() || undefined;
  const domain = resolveGuiDomain();
  const label = resolveGatewayLaunchAgentLabel(profile);
  const plistPath = resolveLaunchAgentPlistPath(profile);
  return {
    domain,
    label,
    plistPath,
    serviceTarget: `${domain}/${label}`,
  };
}

function buildRestartScript(mode: LaunchdRestartHandoffMode): string {
  const waitForCaller = `service_target="$1"
domain="$2"
plist_path="$3"
wait_pid="$4"

if [ -n "$wait_pid" ] && [ "$wait_pid" -gt 1 ] 2>/dev/null; then
  while kill -0 "$wait_pid" >/dev/null 2>&1; do
    sleep 0.1
  done
fi
`;

  if (mode === 'kickstart') {
    return `${waitForCaller}
launchctl enable "$service_target" 2>/dev/null
if launchctl kickstart -k "$service_target" 2>/dev/null; then
  exit 0
fi
# Fallback: bootstrap
if launchctl bootstrap "$domain" "$plist_path" 2>/dev/null; then
  exit 0
fi
launchctl kickstart -k "$service_target" 2>/dev/null
exit $?
`;
  }

  if (mode === 'reload') {
    return `${waitForCaller}
launchctl enable "$service_target" 2>/dev/null
launchctl bootout "$service_target" 2>/dev/null || true
sleep 0.5
if launchctl bootstrap "$domain" "$plist_path" 2>/dev/null; then
  exit 0
fi
exit 1
`;
  }

  // start-after-exit: wait for exit, then verify launchd auto-restarts
  return `${waitForCaller}
# Give launchd a moment to auto-restart via KeepAlive
retry=15
while [ "$retry" -gt 0 ]; do
  if launchctl print "$service_target" >/dev/null 2>&1; then
    exit 0
  fi
  retry=$((retry - 1))
  sleep 0.2
done
# Fallback: bootstrap manually
launchctl enable "$service_target" 2>/dev/null
if launchctl bootstrap "$domain" "$plist_path" 2>/dev/null; then
  exit 0
fi
launchctl kickstart -k "$service_target" 2>/dev/null
exit $?
`;
}

/**
 * Schedule a detached restart handoff script.
 * The script runs independently of the current process — safe to call
 * right before exiting.
 */
export function scheduleDetachedLaunchdRestartHandoff(params: {
  env?: Record<string, string | undefined>;
  mode: LaunchdRestartHandoffMode;
  waitForPid?: number;
}): LaunchdRestartHandoffResult {
  const target = resolveRestartTarget(params.env);
  const waitForPid =
    typeof params.waitForPid === 'number' && Number.isFinite(params.waitForPid)
      ? Math.floor(params.waitForPid)
      : 0;

  const script = buildRestartScript(params.mode);

  try {
    const child = spawn(
      '/bin/sh',
      [
        '-c',
        script,
        'xopc-launchd-restart-handoff',
        target.serviceTarget,
        target.domain,
        target.plistPath,
        String(waitForPid),
      ],
      {
        detached: true,
        stdio: 'ignore',
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      },
    );

    child.unref();

    log.info(
      { mode: params.mode, pid: child.pid, waitForPid, label: target.label },
      'Scheduled detached restart handoff',
    );

    return { ok: true, pid: child.pid ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, mode: params.mode }, 'Failed to schedule restart handoff');
    return { ok: false, detail: message };
  }
}
