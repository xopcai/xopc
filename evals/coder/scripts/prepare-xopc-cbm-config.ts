#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

type JsonRecord = Record<string, unknown>;

export interface PrepareXopcConfigOptions {
  source: string;
  output: string;
  stateDir: string;
  sourceAgent: string;
  baselineAgent: string;
  candidateAgent: string;
  port: number;
}

function expandHome(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function cloneAgent(agent: JsonRecord, id: string): JsonRecord {
  return { ...structuredClone(agent), id, enabled: true };
}

async function copyProfile(sourceStateDir: string, targetStateDir: string, sourceId: string, targetId: string) {
  const source = join(sourceStateDir, 'agents', sourceId, 'profile');
  const target = join(targetStateDir, 'agents', targetId, 'profile');
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function prepareXopcConfig(options: PrepareXopcConfigOptions): Promise<{
  configPath: string;
  stateDir: string;
}> {
  if (options.baselineAgent === options.candidateAgent) {
    throw new Error('baseline and candidate agent ids must differ');
  }
  const sourcePath = resolve(expandHome(options.source));
  const outputPath = resolve(expandHome(options.output));
  const stateDir = resolve(expandHome(options.stateDir));
  const sourceConfig = object(JSON.parse(await readFile(sourcePath, 'utf8')), 'xopc config');
  const agents = object(sourceConfig.agents, 'agents');
  const list = Array.isArray(agents.list) ? agents.list : [];
  const sourceAgent = list
    .map((entry) => object(entry, 'agent manifest'))
    .find((entry) => entry.id === options.sourceAgent);
  if (!sourceAgent) throw new Error(`source agent not found: ${options.sourceAgent}`);

  const gateway = object(sourceConfig.gateway ?? {}, 'gateway');
  const codeIntelligence = object(sourceConfig.codeIntelligence ?? {}, 'codeIntelligence');
  const generated: JsonRecord = {
    ...structuredClone(sourceConfig),
    agents: {
      ...structuredClone(agents),
      default: options.baselineAgent,
      list: [
        cloneAgent(sourceAgent, options.baselineAgent),
        cloneAgent(sourceAgent, options.candidateAgent),
      ],
    },
    bindings: [],
    channels: {},
    gateway: {
      ...structuredClone(gateway),
      bind: 'loopback',
      port: options.port,
    },
    codeIntelligence: {
      ...structuredClone(codeIntelligence),
      enabled: true,
      agentIds: [options.candidateAgent],
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(generated, null, 2)}\n`, { mode: 0o600 });
  await chmod(outputPath, 0o600);
  const sourceStateDir = dirname(sourcePath);
  await Promise.all([
    copyProfile(sourceStateDir, stateDir, options.sourceAgent, options.baselineAgent),
    copyProfile(sourceStateDir, stateDir, options.sourceAgent, options.candidateAgent),
  ]);
  return { configPath: outputPath, stateDir };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: '~/.xopc/xopc.json' },
      output: { type: 'string', default: '.xopc-evals/xopc-cbm-ab/xopc.json' },
      'state-dir': { type: 'string', default: '.xopc-evals/xopc-cbm-ab/state' },
      'source-agent': { type: 'string', default: 'coder' },
      'baseline-agent': { type: 'string', default: 'eval-coder-baseline' },
      'candidate-agent': { type: 'string', default: 'eval-coder-cbm' },
      port: { type: 'string', default: '4321' },
    },
  });
  const port = Number.parseInt(values.port!, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1-65535');
  const result = await prepareXopcConfig({
    source: values.source!,
    output: values.output!,
    stateDir: values['state-dir']!,
    sourceAgent: values['source-agent']!,
    baselineAgent: values['baseline-agent']!,
    candidateAgent: values['candidate-agent']!,
    port,
  });
  console.log(`Config: ${result.configPath}`);
  console.log(`State:  ${result.stateDir}`);
  console.log('The generated config is private (0600), uses loopback, and disables channels.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
