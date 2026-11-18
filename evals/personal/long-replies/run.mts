import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { cases, type LongReplyCase } from './cases.mts';
import { openEvaluationRuntime } from './model.mts';

const out = process.argv[2];
if (!out) throw new Error('Usage: node --import tsx evals/personal/long-replies/run.mts OUTPUT_DIR [--dry-run]');
const runtime = await openEvaluationRuntime();
const { buildSystemPrompt } = await import('../../../src/agent/prompt/system-prompt.js');
const { buildPersonalReplyPrompt, parsePersonalReplyDraft } = await import('../../../src/personal-agent/reply-composer.js');
const { PERSONAL_REPLY_STYLE_RULES } = await import('../../../src/personal-agent/reply-style.js');
const { TaskResultDeliverySchema } = await import('@xopcai/gateway-contract');
type Packet = Parameters<typeof buildPersonalReplyPrompt>[0];
type Completion = Awaited<ReturnType<typeof runtime.complete>>;
const arms = ['A', 'B'] as const;
type Arm = typeof arms[number];

const generationModel = runtime.resolveModel('xopc-cloud/openai-codex/gpt-6.1-sol');
const evaluatorModel = runtime.resolveModel('xopc-cloud/openai-codex/gpt-6-luna');
const baselineRule = 'Let the question determine how much to say. Lead with the answer and include the evidence and uncertainty that affect the reader’s understanding. Cut repeated context, routine process, and low-value detail. Honor a numerical length limit when the user sets one. Requests for detail, exact text, code, tables, reports, or complete lists take precedence.';
const candidateRule = 'Write the reply as a short message to one person. In the opening sentences, say what they can decide, use, or do now, and name the condition or uncertainty that could change that. For a decision, include the decisive trade-offs once. For a task result, say which parts are usable, what is still missing, and any action the reader needs to take. Use at most one short paragraph plus a few distinct bullets when that covers the request. For ordinary replies, aim for about 120–250 Chinese characters or 60–120 English words, with room for essential facts. Keep the figures, deadlines, and limits needed to act. Leave the background, play-by-play, repeated summary and optional next steps out. Honor a numerical length limit when the user sets one. Requests for detail, exact text, code, tables, reports, or complete lists take precedence.';
const existingRule = PERSONAL_REPLY_STYLE_RULES.find((rule: string) => rule === baselineRule || rule === candidateRule);
if (!existingRule) throw new Error('Cannot locate production reply length rule');
const readerPrompt = '你是收到回复的中文读者，只能看到提问和回复开头。请说出开头真正告诉你的结论，以及最关键的下一步或限制。若某项未说明，写“未说明”。不能靠常识、问题暗示或猜测补齐。返回恰好两个字符串组成的 JSON 数组。';
const judgePrompt = [
  '你在盲评同一案例的两份答复，first/second 与版本无关。先核对开头和模拟读者答案，再逐项核对全文。',
  'lead 为两个布尔值。只有模拟读者答出对应要点、且回复开头足以支持该答案时记 true。允许等义、按问题实际要求判断。若本例是完整交付对照，lead 固定为 [false,false]。',
  'facts 的每项为 kept、omitted 或 wrong，表示全文保留、部分/完全缺失、或与来源冲突。可接受明确的直接推论。若漏了项目中的一个关键限制则记 omitted。',
  'critical 只列正文中影响决策的新增错误，例如虚构授权、把未发布说成已发布、错报金额或日期。格式 {"first":{"lead":[true,true],"facts":["kept"],"critical":[],"notes":[]},"second":{"lead":[true,true],"facts":["kept"],"critical":[],"notes":[]}}。facts 顺序/数量和输入一致。只返回 JSON。',
].join('\n');

const composerPath = 'src/personal-agent/reply-composer.ts';
const composerSystem = readFileSync(composerPath, 'utf8')
  .match(/systemPrompt: '(Return a concise plain-text reply about the current Task only[^']+)'/)?.[1];
if (!composerSystem) throw new Error('Cannot locate production Composer system prompt');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const tracked = ['evals/personal/long-replies/run.mts', 'evals/personal/long-replies/model.mts', 'evals/personal/long-replies/cases.mts',
  'src/agent/prompt/system-prompt.ts', 'src/personal-agent/prompts.ts', composerPath, 'src/personal-agent/reply-style.ts', 'pnpm-lock.yaml'];
const fingerprint = () => Object.fromEntries(tracked.map(path => [path, sha(readFileSync(path))]));
const manifest = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sources: fingerprint(),
  model: generationModel.id, evaluator: evaluatorModel.id, repetitions: 1, samples: cases.length,
  baselineRule, candidateRule, readerPrompt, judgePrompt, longThresholdChars: 350, maxLeadChars: 240,
  gate: 'In the non-control subset with A >= 350 characters (at least 6 cases), B reduces median reply length by >= 15% without decreasing opening comprehension. Across all non-controls B has no lead/fact regression within either path, zero adjudicated critical errors, and all full-content controls pass.',
};
mkdirSync(out, { recursive: true });
function save(name: string, content: unknown) {
  const target = join(out, name);
  writeFileSync(target + '.tmp', JSON.stringify(content, null, 2) + '\n');
  renameSync(target + '.tmp', target);
}
function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(out, name), 'utf8')) as T;
}
if (existsSync(join(out, 'manifest.json'))) {
  if (JSON.stringify(load('manifest.json')) !== JSON.stringify(manifest)) throw new Error('Frozen benchmark inputs changed');
} else {
  save('manifest.json', manifest);
}
function prepare(item: LongReplyCase) {
  const replace = (text: string, rule: string) => {
    if (!text.includes(existingRule!)) throw new Error('Production style block not found for ' + item.id);
    return text.replace(existingRule!, rule);
  };
  if (item.path === 'chat') {
    const baseline = buildSystemPrompt('/evaluation/workspace', {
      promptRole: 'personal', agentId: 'personal', toolNames: [], userTimezone: 'Asia/Shanghai',
    });
    const user = item.request + '\n\n材料如下。\n' + item.source;
    return { A: { system: replace(baseline, baselineRule), user }, B: { system: replace(baseline, candidateRule), user }, packet: undefined };
  }
  const status = item.status ?? 'succeeded';
  const packet: Packet = {
    objective: item.request, report: item.source, taskVersion: 1,
    verificationStatus: status === 'succeeded' ? 'passed' : 'unverified',
    ...(item.control === 'verbatim' ? { preservedText: item.source } : {}),
    delivery: TaskResultDeliverySchema.parse({
      version: 1, deliveryId: item.id, taskId: item.id, taskRunId: item.id, taskTitle: item.request,
      conversationId: item.id, originTranscriptId: item.id, assignmentEpoch: 1,
      outcome: { version: 1, outcomeId: item.id, runId: item.id, turnId: item.id, status,
        deliverables: item.artifact ? [{ artifactId: item.id, title: item.artifact, kind: 'document',
          availability: 'available', location: 'artifact_store', capabilities: ['download'] }] : [],
        evidence: [], createdAt: '2026-11-18T00:00:00Z' },
      createdAt: 1794960000000,
    }),
  };
  const production = buildPersonalReplyPrompt(packet, false);
  const split = production.lastIndexOf('\n\n');
  const context = JSON.parse(production.slice(split + 2));
  context.task = { receipt: { verification: packet.verificationStatus, needsUser: item.needsUser ?? false } };
  const user = production.slice(0, split) + '\n\n' + JSON.stringify(context);
  return { A: { system: composerSystem!, user: replace(user, baselineRule) }, B: { system: composerSystem!, user: replace(user, candidateRule) }, packet };
}

const chars = (text: string) => [...text.replace(/\s+/gu, '')].length;
function opening(text: string) {
  const first = text.trim().split(/\n[ \t]*\n/u).find(block => !/^#{1,6}\s+[^\n]+$/u.test(block.trim())) ?? '';
  const firstContent = first.replace(/^#{1,6}\s+[^\n]+\n/u, '').trim();
  return [...firstContent].slice(0, manifest.maxLeadChars).join('');
}
const answerSchema = z.tuple([z.string().min(1), z.string().min(1)]);
const armGrade = z.object({
  lead: z.tuple([z.boolean(), z.boolean()]),
  facts: z.array(z.enum(['kept', 'omitted', 'wrong'])),
  critical: z.array(z.string()), notes: z.array(z.string()),
});
const gradeSchema = z.object({ first: armGrade, second: armGrade });
async function jsonCompletion<T>(system: string, content: string, schema: z.ZodType<T>, operation: 'read' | 'judge', name: string) {
  for (let attempt = 1; ; attempt++) {
    const completion = await runtime.complete(evaluatorModel, system, content, operation);
    try {
      const parsed = JSON.parse(completion.text.replace(/^\s*```(?:json)?\s*/iu, '').replace(/\s*```\s*$/u, ''));
      return { completion, value: schema.parse(parsed) };
    } catch (error) {
      save('invalid-' + name + '-' + attempt + '.json', { completion, error: String(error) });
      if (attempt === 2) throw error;
    }
  }
}

async function concurrent<T>(items: readonly T[], work: (item: T) => Promise<void>) {
  const queue = items.slice();
  const errors: string[] = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      try { await work(item); }
      catch (error) { errors.push(String(error)); console.error(String(error)); }
    }
  }));
  if (errors.length) throw new Error(errors.length + ' failed operations; rerun the same directory to resume successful checkpoints');
}

type Generation = { completion: Completion; displayed: string; opening: string; chars: number; valid: boolean; exact: boolean | null };
type Reading = Awaited<ReturnType<typeof jsonCompletion<z.infer<typeof answerSchema>>>>;
type Grade = z.infer<typeof armGrade>;
const generated = (id: string, arm: Arm) => load<Generation>('draft-' + id + '-' + arm + '.json');
const reading = (id: string, arm: Arm) => load<Reading>('read-' + id + '-' + arm + '.json');

try {
  const inputs = new Map(cases.map(item => [item.id, prepare(item)]));
  if (process.argv.includes('--dry-run')) {
    console.log('Prepared ' + inputs.size + ' fixed pairs, including four exact/full controls');
  } else {
    const pairs = cases.flatMap((item, i) => (i % 2 ? ['B', 'A'] as const : arms).map(arm => ({ item, arm })));
    await concurrent(pairs, async ({ item, arm }) => {
      const file = 'draft-' + item.id + '-' + arm + '.json';
      if (existsSync(join(out, file))) return;
      const input = inputs.get(item.id)!;
      const completion = await runtime.complete(generationModel, input[arm].system, input[arm].user, 'generate');
      const draft = completion.text;
      let valid = draft.trim() !== 'NO_REPLY';
      if (input.packet) {
        try { parsePersonalReplyDraft(draft, input.packet); }
        catch { valid = false; }
      }
      const displayed = item.control === 'verbatim' ? draft + '\n\n' + item.source : draft;
      const exact = item.control === 'verbatim'
        ? displayed.endsWith(item.source) && !draft.includes(item.source) && !draft.includes(item.source.split('\n')[0]!)
        : item.id === 'X01' ? displayed === item.source : null;
      save(file, { completion, displayed, opening: opening(displayed), chars: chars(displayed), valid, exact } satisfies Generation);
      console.log('generated', item.id, arm);
    });
    await concurrent(pairs.filter(({ item }) => !item.control), async ({ item, arm }) => {
      const file = 'read-' + item.id + '-' + arm + '.json';
      if (existsSync(join(out, file))) return;
      const content = JSON.stringify({ 用户提问: item.request, 回复开头: generated(item.id, arm).opening });
      save(file, await jsonCompletion(readerPrompt, content, answerSchema, 'read', item.id + '-' + arm));
      console.log('read', item.id, arm);
    });
    await concurrent(cases.filter(item => item.facts.length > 0), async item => {
      const file = 'grade-' + item.id + '.json';
      if (existsSync(join(out, file))) return;
      const order = parseInt(sha('personal-long-v1-' + item.id).slice(0, 2), 16) % 2 ? arms : ['B', 'A'] as const;
      const display = (arm: Arm) => {
        const draft = generated(item.id, arm);
        return { reply: draft.displayed, opening: draft.opening, readerAnswers: item.control ? undefined : reading(item.id, arm).value };
      };
      const content = JSON.stringify({ 用户请求: item.request, 来源: item.source, 交付状态: item.status,
        信息预期: item.lead, 事实: item.facts, 完整交付对照: Boolean(item.control), first: display(order[0]), second: display(order[1]) });
      const parsed = await jsonCompletion(judgePrompt, content, gradeSchema, 'judge', item.id);
      if (parsed.value.first.facts.length !== item.facts.length || parsed.value.second.facts.length !== item.facts.length) {
        save('wrong-count-' + item.id + '.json', parsed);
        throw new Error('Fact count mismatch: ' + item.id);
      }
      save(file, { ...parsed, order, grades: { [order[0]]: parsed.value.first, [order[1]]: parsed.value.second } });
      console.log('graded', item.id);
    });

    if (JSON.stringify(fingerprint()) !== JSON.stringify(manifest.sources)) throw new Error('Evaluation sources changed during the run');
    const rows = cases.map(item => ({
      ...item,
      draft: { A: generated(item.id, 'A'), B: generated(item.id, 'B') },
      reader: item.control ? null : { A: reading(item.id, 'A'), B: reading(item.id, 'B') },
      grades: item.facts.length ? load<{ grades: Record<Arm, Grade> }>('grade-' + item.id + '.json').grades : null,
    }));
    const ordinary = rows.filter(item => !item.control);
    const long = ordinary.filter(item => item.draft.A.chars >= manifest.longThresholdChars);
    const controls = rows.filter(item => item.control);
    const percentile = (values: number[], fraction: number) => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? null;
    function summarize(group: typeof rows, arm: Arm) {
      const lengths = group.map(item => item.draft[arm].chars);
      return {
        cases: group.length, medianChars: percentile(lengths, .5), p90Chars: percentile(lengths, .9),
        atLeast350: lengths.filter(length => length >= 350).length,
        lead: group.reduce((acc, item) => acc + (item.control ? 0 : item.grades![arm].lead.filter(Boolean).length), 0),
        leadTotal: group.filter(item => !item.control).length * 2,
        facts: group.reduce((acc, item) => acc + (item.grades?.[arm].facts.filter(fact => fact === 'kept').length ?? 0), 0),
        factsTotal: group.reduce((acc, item) => acc + item.facts.length, 0),
        criticalCases: group.filter(item => item.grades?.[arm].critical.length).length,
        invalidDrafts: group.filter(item => !item.draft[arm].valid).length,
        fullControls: group.filter(item => item.control && (item.draft[arm].exact ?? item.grades![arm].facts.every(fact => fact === 'kept'))).length,
      };
    }
    const pair = (group: typeof rows) => ({ A: summarize(group, 'A'), B: summarize(group, 'B') });
    const summary = { overall: pair(ordinary), chat: pair(ordinary.filter(item => item.path === 'chat')),
      delivery: pair(ordinary.filter(item => item.path === 'delivery')), baselineLong: pair(long), controls: pair(controls), longIds: long.map(item => item.id) };
    save('results.json', { summary, cases: rows });
    console.log(JSON.stringify(summary, null, 2));
  }
} finally {
  if (!process.argv.includes('--dry-run') && runtime.retryEvents.length) {
    const old = existsSync(join(out, 'transport-retries.json')) ? load<typeof runtime.retryEvents>('transport-retries.json') : [];
    save('transport-retries.json', [...old, ...runtime.retryEvents]);
  }
  runtime.close();
}
