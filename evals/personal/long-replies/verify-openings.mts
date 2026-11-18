import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { cases } from './cases.mts';
import { openEvaluationRuntime } from './model.mts';

const out = process.argv[2];
if (!out) throw new Error('Usage: node --import tsx evals/personal/long-replies/verify-openings.mts OUTPUT_DIR');
const runtime = await openEvaluationRuntime();
const evaluator = runtime.resolveModel('xopc-cloud/openai-codex/gpt-6-luna');
const prompt = [
  '评估仅阅读回复首段能否理解两个具体要点。你没有看到全文。first/second 是盲评顺序。',
  '每份答卷的两个要点分别判断。只有首段表达了整项预期、且读者在两条作答中的任意一条表明理解了该要点，才返回支持它的首段原文（连续的一段字串）。需要多处时可引用整个首段。两条作答为同一读者，不要求顺序一致。',
  '不能用用户问题或常识补全要点。仅提到“见下文”“待批准”“两件事”等泛化字句，不能替代明确的动作、限制、阈值或对象。多分句的预期都要满足，等义表达和“或”条件按原意判断。少一个关键条件时返回 null。',
  '只输出两行，每行是一个恰有两个元素的 JSON 数组。每个元素是首段原文字符串或 null。第一行为 first，第二行为 second。不要输出解释或代码围栏。',
].join('\n');
const arms = ['A', 'B'] as const;
const quotePair = z.tuple([z.string().min(1).nullable(), z.string().min(1).nullable()]);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function load<T>(name: string) {
  return JSON.parse(readFileSync(join(out, name), 'utf8')) as T;
}
function save(name: string, value: unknown) {
  const path = join(out, name);
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n');
  renameSync(path + '.tmp', path);
}
const manifest = {
  evaluator: evaluator.id, prompt,
  graderSource: hash(readFileSync(new URL(import.meta.url))),
  fixtureSource: hash(readFileSync(new URL('./cases.mts', import.meta.url))),
  captureManifest: hash(readFileSync(join(out, 'manifest.json'))),
};
if (existsSync(join(out, 'opening-manifest.json'))) {
  if (JSON.stringify(load('opening-manifest.json')) !== JSON.stringify(manifest)) throw new Error('Opening verifier provenance changed');
} else {
  save('opening-manifest.json', manifest);
}
const ordinary = cases.filter(item => !item.control);
const queue = ordinary.slice();
const failures: string[] = [];
try {
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      const output = 'opening-' + item.id + '.json';
      if (existsSync(join(out, output))) continue;
      const extract = (arm: typeof arms[number]) => {
        const prefix = load<{ opening: string }>('draft-' + item.id + '-' + arm + '.json').opening;
        const reader = load<{ value: [string, string] }>('read-' + item.id + '-' + arm + '.json').value;
        return { 首段: prefix, 读者作答: reader };
      };
      const order = parseInt(hash('first-block-v2:' + item.id).slice(0, 2), 16) % 2 ? arms : ['B', 'A'] as const;
      const views = order.map(extract);
      const input = JSON.stringify({ 用户请求: item.request, 预期理解: item.lead, first: views[0], second: views[1] });
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await runtime.complete(evaluator, prompt, input, 'judge').catch(error => ({ error: String(error) }));
        try {
          if ('error' in result) throw new Error(result.error);
          const lines = result.text.replace(/^\s*```(?:json)?\s*/iu, '').replace(/\s*```\s*$/u, '').split('\n').filter(line => line.trim());
          if (lines.length !== 2) throw new Error('Expected two JSON arrays');
          const validated = lines.map((line, index) => {
            const quotes = quotePair.parse(JSON.parse(line)) as [string | null, string | null];
            return quotes.map(quote => quote && views[index]!.首段.includes(quote) ? quote : null);
          });
          save(output, { result, order, quotes: { [order[0]]: validated[0], [order[1]]: validated[1] } });
          console.log('opening verified', item.id);
          break;
        } catch (error) {
          save('opening-invalid-' + item.id + '-' + attempt + '.json', { result, error: String(error) });
          if (attempt === 3) failures.push(item.id);
        }
      }
    }
  }));
  if (failures.length) throw new Error('Opening grades incomplete: ' + failures.join(', '));
  const rows = ordinary.map(item => ({ id: item.id, path: item.path,
    aChars: load<{ chars: number }>('draft-' + item.id + '-A.json').chars,
    ...load<{ quotes: Record<typeof arms[number], (string | null)[]> }>('opening-' + item.id + '.json'),
  }));
  const summarize = (items: typeof rows) => ({
    A: items.reduce((total, row) => total + row.quotes.A.filter(Boolean).length, 0),
    B: items.reduce((total, row) => total + row.quotes.B.filter(Boolean).length, 0),
    total: items.length * 2,
  });
  const summary = { all: summarize(rows), chat: summarize(rows.filter(row => row.path === 'chat')),
    delivery: summarize(rows.filter(row => row.path === 'delivery')), long: summarize(rows.filter(row => row.aChars >= 350)) };
  save('opening-results.json', { summary, rows });
  console.log(JSON.stringify(summary));
} finally {
  runtime.close();
}
