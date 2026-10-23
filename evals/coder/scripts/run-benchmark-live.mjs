import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { main } from './run-github-eval.mjs';

const { values } = parseArgs({ options: {
  model: { type: 'string' },
  suite: { type: 'string', default: 'xopc-core' },
  output: { type: 'string' },
  repetitions: { type: 'string', default: '1' },
  reasoning: { type: 'string' },
  cases: { type: 'string' },
  'seal-grader': { type: 'boolean', default: false },
  'max-turns': { type: 'string', default: '40' },
} });
if (!['xopc-core', 'xopc-agent-growth', 'xopc-delivery-holdout', 'xopc-ledger-holdout'].includes(values.suite)) throw new Error('Unknown benchmark suite');
if (!values.model) throw new Error('Pass --model provider/model; credentials are resolved locally and passed only to the isolated Gateway.');
const output = resolve(values.output ?? `.xopc-evals/live-core-v1-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(dirname(output), { recursive: true });
process.env.XOPC_LOG_LEVEL = 'fatal';
const { getApiKey, resolveModel } = await import('../../../src/providers/index.ts');
const { getModelThinking } = await import('../../../src/providers/model-thinking.ts');
const thinking = getModelThinking(resolveModel(values.model));
const reasoning = values.reasoning ?? thinking.initialValue;
if (!thinking.options.includes(reasoning)) throw new Error(`Unsupported reasoning level; choose one of: ${thinking.options.join(', ')}`);
const key = await getApiKey(values.model.split('/')[0]);
if (!key) throw new Error('The selected provider has no configured API key. Use the direct Gateway adapter for OAuth or custom model registries.');
process.env.CODER_EVAL_MODEL = values.model;
process.env.CODER_EVAL_API_KEY = key;
process.env.CODER_EVAL_REASONING = reasoning;
process.env.CODER_EVAL_REPETITIONS = values.repetitions;
const maxTurns = Number(values['max-turns']);
if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 40) throw new Error('--max-turns must be 1–40');
process.env.XOPC_EVAL_MAX_TURNS = String(maxTurns);
await main({ sealGrader: values['seal-grader'], maxTurns, benchmark: true, benchmarkSuite: values.suite, benchmarkCases: values.cases, outputDirectory: output });
