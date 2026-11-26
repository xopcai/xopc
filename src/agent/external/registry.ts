import type { ExternalAgentExecution, ExternalAgentKind } from '../../agent-config/schema.js';
import { agyExternalDriver } from './drivers/agy/driver.js';
import { codexExternalDriver } from './drivers/codex/driver.js';
import type { ExternalAgentDriver, ExternalRuntimeProbeResult } from './types.js';

const BUILT_IN_DRIVERS: ReadonlyArray<ExternalAgentDriver> = [
  codexExternalDriver,
  agyExternalDriver,
];

const registry = new Map<ExternalAgentKind, ExternalAgentDriver>(
  BUILT_IN_DRIVERS.map(driver => [driver.kind, driver]),
);

export function getExternalAgentDriver(kind: ExternalAgentKind): ExternalAgentDriver {
  const driver = registry.get(kind);
  if (!driver) throw new Error(`Unsupported external agent runtime: ${kind}`);
  return driver;
}

export function listExternalAgentDrivers(): ReadonlyArray<ExternalAgentDriver> {
  return [...registry.values()];
}

export function probeExternalAgentRuntime(
  execution: ExternalAgentExecution,
): Promise<ExternalRuntimeProbeResult> {
  return getExternalAgentDriver(execution.kind).probe(execution);
}

export function probeAllExternalAgentRuntimes(): Promise<ExternalRuntimeProbeResult[]> {
  return Promise.all(BUILT_IN_DRIVERS.map(driver => driver.probe({ kind: driver.kind } as ExternalAgentExecution)));
}
