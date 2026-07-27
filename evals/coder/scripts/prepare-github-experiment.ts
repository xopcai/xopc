#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { ExperimentSpec } from '@agent-evals/protocol';
import { parse, stringify } from 'yaml';

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'evals/coder/suites/xopc-cbm-pilot/experiment.yaml' },
    output: { type: 'string', default: '.xopc-evals/github/experiment.yaml' },
    repetitions: { type: 'string', default: '3' },
    model: { type: 'string' },
    reasoning: { type: 'string' },
  },
});

const repetitions = Number.parseInt(values.repetitions!, 10);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
  throw new Error('repetitions must be an integer between 1 and 10');
}
const source = resolve(values.source!);
const output = resolve(values.output!);
const experiment = parse(await readFile(source, 'utf8')) as ExperimentSpec;
if (!Array.isArray(experiment.variants) || experiment.variants.length < 2) {
  throw new Error('GitHub experiment requires at least two variants');
}

const model = values.model?.trim();
const reasoning = values.reasoning?.trim();
const effective: ExperimentSpec = {
  ...experiment,
  name: `${experiment.name} (GitHub Actions)`,
  repetitions,
  variants: experiment.variants.map((variant) => ({
    ...variant,
    ...(model ? { model } : {}),
    ...(reasoning && reasoning !== 'configured' ? { reasoning } : {}),
  })),
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, stringify(effective), { mode: 0o600 });
console.log(`Experiment: ${output}`);
