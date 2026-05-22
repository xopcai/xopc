/**
 * Service Audit - Validate installed service configuration against current state
 *
 * Checks for:
 * - Version mismatch (installed vs current)
 * - Token drift (service token vs config token)
 * - Missing program binary
 * - Port mismatch
 * - Platform-specific configuration issues
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createLogger } from '../utils/logger.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { SERVICE_VERSION_ENV_KEY } from './constants.js';
import type { GatewayService, GatewayServiceCommandConfig, GatewayServiceEnv } from './types.js';

const log = createLogger('ServiceAudit');

// ─── Types ───

export type ServiceAuditCode =
  | 'version-mismatch'
  | 'token-drift'
  | 'missing-program'
  | 'temporary-program'
  | 'port-mismatch'
  | 'launchd-keep-alive'
  | 'launchd-run-at-load';

export interface ServiceAuditIssue {
  code: ServiceAuditCode;
  message: string;
  detail?: string;
  level?: 'recommended' | 'aggressive';
}

export interface ServiceAuditResult {
  ok: boolean;
  issues: ServiceAuditIssue[];
}

// ─── Main Audit Function ───

/** Audit installed service configuration against current config and version */
export async function auditGatewayServiceConfig(params: {
  service: GatewayService;
  env?: GatewayServiceEnv;
  expectedToken?: string;
  expectedPort?: number;
  currentVersion?: string;
}): Promise<ServiceAuditResult> {
  const {
    service,
    env = process.env,
    expectedToken,
    expectedPort,
    currentVersion = PACKAGE_VERSION,
  } = params;

  const issues: ServiceAuditIssue[] = [];

  // Read command from installed service
  const command = await service.readCommand(env);
  if (!command) {
    issues.push({
      code: 'missing-program',
      message: 'Service command configuration is not readable.',
      level: 'recommended',
    });
    return { ok: false, issues };
  }

  // Check program exists
  auditProgramExists(command, issues);

  // Check version mismatch
  auditVersionMismatch(command, currentVersion, issues);

  // Check token drift
  if (expectedToken) {
    const tokenIssue = checkTokenDrift({
      serviceToken: command.environment?.[`XOPC_GATEWAY_TOKEN`],
      configToken: expectedToken,
    });
    if (tokenIssue) {
      issues.push(tokenIssue);
    }
  }

  // Check port mismatch
  if (expectedPort) {
    auditPortMismatch(command, expectedPort, issues);
  }

  // Platform-specific checks
  if (process.platform === 'darwin' && command.sourcePath) {
    await auditLaunchdPlist(command.sourcePath, issues);
  }

  return { ok: issues.length === 0, issues };
}

// ─── Individual Checks ───

function auditProgramExists(command: GatewayServiceCommandConfig, issues: ServiceAuditIssue[]): void {
  if (command.programArguments.length === 0) {
    issues.push({
      code: 'missing-program',
      message: 'Service has no program arguments configured.',
      level: 'recommended',
    });
    return;
  }

  const program = command.programArguments[0];
  if (!existsSync(program)) {
    issues.push({
      code: 'missing-program',
      message: `Service program not found on disk: ${program}`,
      detail: program,
      level: 'recommended',
    });
  }
}

function auditVersionMismatch(
  command: GatewayServiceCommandConfig,
  currentVersion: string,
  issues: ServiceAuditIssue[],
): void {
  const serviceVersion = command.environment?.[SERVICE_VERSION_ENV_KEY];
  if (!serviceVersion) return;

  if (serviceVersion !== currentVersion) {
    issues.push({
      code: 'version-mismatch',
      message: `Service version ${serviceVersion} does not match current ${currentVersion}.`,
      detail: `${serviceVersion} → ${currentVersion}`,
      level: 'recommended',
    });
  }
}

function auditPortMismatch(
  command: GatewayServiceCommandConfig,
  expectedPort: number,
  issues: ServiceAuditIssue[],
): void {
  const servicePort = readCommandPort(command.programArguments);
  if (servicePort === undefined || servicePort === expectedPort) return;

  issues.push({
    code: 'port-mismatch',
    message: `Service port ${servicePort} does not match config port ${expectedPort}.`,
    detail: `${servicePort} → ${expectedPort}`,
    level: 'recommended',
  });
}

async function auditLaunchdPlist(plistPath: string, issues: ServiceAuditIssue[]): Promise<void> {
  try {
    const content = await readFile(plistPath, 'utf8');

    const hasRunAtLoad = /<key>RunAtLoad<\/key>\s*<true\s*\/>/i.test(content);
    const hasKeepAlive = /<key>KeepAlive<\/key>/i.test(content);

    if (!hasRunAtLoad) {
      issues.push({
        code: 'launchd-run-at-load',
        message: 'LaunchAgent is missing RunAtLoad=true.',
        detail: plistPath,
        level: 'recommended',
      });
    }

    if (!hasKeepAlive) {
      issues.push({
        code: 'launchd-keep-alive',
        message: 'LaunchAgent is missing KeepAlive configuration.',
        detail: plistPath,
        level: 'recommended',
      });
    }
  } catch {
    // File not readable; skip plist-specific checks
  }
}

// ─── Token Drift ───

/**
 * Check if the service's embedded token differs from the config file token.
 * Returns an issue if drift is detected.
 */
export function checkTokenDrift(params: {
  serviceToken: string | undefined;
  configToken: string | undefined;
}): ServiceAuditIssue | null {
  const serviceToken = params.serviceToken?.trim();
  const configToken = params.configToken?.trim();

  // No service token = no drift (token loaded at runtime)
  if (!serviceToken) return null;

  // No config token = can't compare
  if (!configToken) return null;

  if (serviceToken !== configToken) {
    return {
      code: 'token-drift',
      message: 'Config token differs from service token. The daemon will use the old token after restart.',
      detail: 'Run `xopc gateway service install --force` to sync.',
      level: 'recommended',
    };
  }

  return null;
}

// ─── Helpers ───

function readCommandPort(programArguments: string[]): number | undefined {
  for (let i = 0; i < programArguments.length; i++) {
    const arg = programArguments[i];
    if (arg === '--port' && i + 1 < programArguments.length) {
      const port = parseInt(programArguments[i + 1], 10);
      return Number.isFinite(port) && port > 0 && port <= 65535 ? port : undefined;
    }
    if (arg.startsWith('--port=')) {
      const port = parseInt(arg.slice('--port='.length), 10);
      return Number.isFinite(port) && port > 0 && port <= 65535 ? port : undefined;
    }
  }
  return undefined;
}
