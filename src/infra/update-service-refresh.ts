import fs from 'node:fs/promises';
import path from 'node:path';

import { formatGatewayServiceDescription, SERVICE_VERSION_ENV_KEY } from '../daemon/constants.js';
import type {
  GatewayService,
  GatewayServiceCommandConfig,
  GatewayServiceInstallArgs,
} from '../daemon/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UpdateServiceRefresh');

type PackageJsonBin = string | Record<string, string>;

function resolveBinPath(bin: PackageJsonBin | undefined): string | null {
  if (typeof bin === 'string') {
    return bin;
  }
  if (!bin || typeof bin !== 'object') {
    return null;
  }
  return bin.xopc ?? Object.values(bin).find((value) => typeof value === 'string') ?? null;
}

export async function resolveUpdatedGatewayEntryPoint(packageRoot: string): Promise<string> {
  const resolvedRoot = path.resolve(packageRoot);
  const packageJsonPath = path.join(resolvedRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    bin?: PackageJsonBin;
  };
  const binPath = resolveBinPath(packageJson.bin);
  if (!binPath) {
    throw new Error(`Updated package has no xopc CLI entry point: ${packageJsonPath}`);
  }

  const entryPoint = path.resolve(resolvedRoot, binPath);
  const relative = path.relative(resolvedRoot, entryPoint);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Updated xopc CLI entry point escapes its package root: ${binPath}`);
  }
  await fs.access(entryPoint);
  return entryPoint;
}

export function buildRefreshedGatewayServiceArgs(params: {
  command: GatewayServiceCommandConfig;
  entryPoint: string;
  expectedVersion: string;
  env?: NodeJS.ProcessEnv;
}): GatewayServiceInstallArgs {
  const programArguments = [...params.command.programArguments];
  const gatewayArgIndex = programArguments.findLastIndex((arg) => arg === 'gateway');
  if (gatewayArgIndex < 2) {
    throw new Error('Gateway service command does not contain a replaceable Node.js CLI entry point.');
  }

  programArguments[gatewayArgIndex - 1] = params.entryPoint;
  const environment = {
    ...params.command.environment,
    [SERVICE_VERSION_ENV_KEY]: params.expectedVersion,
    XOPC_SERVICE_MARKER: '1',
  };
  const profile = params.env?.XOPC_PROFILE?.trim() || undefined;

  return {
    env: params.env ?? process.env,
    stdout: process.stdout,
    programArguments,
    workingDirectory: params.command.workingDirectory,
    environment,
    description: formatGatewayServiceDescription({
      profile,
      version: params.expectedVersion,
    }),
  };
}

export async function refreshGatewayServiceAfterUpdate(params: {
  service: GatewayService;
  packageRoot: string;
  expectedVersion: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = params.env ?? process.env;
  const command = await params.service.readCommand(env);
  if (!command) {
    throw new Error('Could not read the installed gateway service command.');
  }

  const entryPoint = await resolveUpdatedGatewayEntryPoint(params.packageRoot);
  const installArgs = buildRefreshedGatewayServiceArgs({
    command,
    entryPoint,
    expectedVersion: params.expectedVersion,
    env,
  });
  await params.service.install(installArgs);
  log.info(
    { entryPoint, expectedVersion: params.expectedVersion },
    'Refreshed gateway service definition after update',
  );
}
