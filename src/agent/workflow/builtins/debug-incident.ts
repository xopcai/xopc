/**
 * Built-in workflow: `debug_incident`
 *
 * Triage an error, stack trace, or log snippet. Parses the signal, fans out
 * parallel hypotheses (config, race, dependency, data, environment), then
 * ranks likely root causes with verification steps.
 *
 * Args:
 *   - error: error message or stack trace
 *   - logs: optional log excerpt
 *   - context: optional extra context (what changed, when it started)
 */

export const DEBUG_INCIDENT_SCRIPT = `export const meta = {
  name: 'debug_incident',
  description: 'Triage an error or log snippet with parallel hypotheses and ranked root-cause analysis.',
  whenToUse: 'User reports a bug, crash, error message, or unexpected behavior and wants systematic triage.',
  examplePrompts: [
    { field: 'error', text: 'Triage this stack trace from production' },
    { field: 'error', text: 'Why does the gateway return 502 after deploy?' },
  ],
  i18n: {
    zh: {
      description: '对错误或日志片段做并行假设推演，并排序根因与验证步骤。',
      whenToUse: '用户报告 bug、崩溃、报错或异常行为，需要系统化排查时。',
      examplePrompts: [
        { field: 'error', text: '排查生产环境这条堆栈' },
        { field: 'error', text: '部署后网关返回 502，可能是什么原因？' },
      ],
    },
  },
  tags: ['debug', 'incident', 'troubleshooting'],
  estimatedAgents: { min: 7, max: 7 },
  phases: [
    { title: 'Triage' },
    { title: 'Hypotheses' },
    { title: 'Rank' },
  ],
}

const READ_TOOLS = ['read_file', 'grep', 'find', 'list_dir', 'shell']

const error = args && typeof args === 'object' && args.error
  ? String(args.error)
  : 'Infer the primary error from the most recent user message or conversation context.'

const logs = args && typeof args === 'object' && args.logs
  ? String(args.logs)
  : ''

const context = args && typeof args === 'object' && args.context
  ? String(args.context)
  : ''

phase('Triage')
const triage = await agent(
  'Parse this incident signal. Extract: error type, likely subsystem, affected files/modules if identifiable, and 2–3 key facts from logs.\\n\\n' +
    'ERROR:\\n' + error + '\\n\\n' +
    (logs ? 'LOGS:\\n' + logs + '\\n\\n' : '') +
    (context ? 'CONTEXT:\\n' + context + '\\n\\n' : '') +
    'Use read/grep tools to locate relevant code if the workspace may contain the failing path.',
  {
    label: 'incident triage',
    toolset: READ_TOOLS,
    schema: {
      type: 'object',
      properties: {
        errorType: { type: 'string' },
        subsystem: { type: 'string' },
        affectedPaths: { type: 'array', items: { type: 'string' } },
        keyFacts: { type: 'array', items: { type: 'string' } },
      },
      required: ['errorType', 'keyFacts'],
    },
  },
)

const HYPOTHESES = [
  { key: 'config', angle: 'Misconfiguration, missing env vars, wrong defaults, feature flags, stale config cache.' },
  { key: 'race', angle: 'Concurrency, timing, ordering, partial failure under load, missing locks or awaits.' },
  { key: 'dependency', angle: 'Version mismatch, breaking upstream change, network/API failure, timeout, auth expiry.' },
  { key: 'data', angle: 'Bad input, schema drift, null/empty edge case, corrupt state, migration gap.' },
  { key: 'environment', angle: 'OS, permissions, disk, memory, container/network isolation, platform-specific behavior.' },
]

phase('Hypotheses')
const hypothesisReports = await parallel(
  HYPOTHESES.map((h) => () =>
    agent(
      'Evaluate whether this hypothesis explains the incident. Search the codebase for supporting or refuting evidence.\\n\\n' +
        'HYPOTHESIS: ' + h.key + ' — ' + h.angle + '\\n\\n' +
        'TRIAGE:\\n' + JSON.stringify(triage, null, 2) + '\\n\\n' +
        'ERROR:\\n' + error + '\\n\\n' +
        (logs ? 'LOGS:\\n' + logs + '\\n\\n' : '') +
        'Return: likelihood (low/med/high), evidence (file paths + brief notes), and one verification step.',
      {
        label: h.key + ' hypothesis',
        toolset: READ_TOOLS,
        schema: {
          type: 'object',
          properties: {
            likelihood: { type: 'string', enum: ['low', 'med', 'high'] },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  note: { type: 'string' },
                },
                required: ['path', 'note'],
              },
            },
            verificationStep: { type: 'string' },
          },
          required: ['likelihood', 'evidence', 'verificationStep'],
        },
      },
    ),
  ),
)

phase('Rank')
const live = hypothesisReports.filter(Boolean)
const byHypothesis = {}
for (let i = 0; i < HYPOTHESES.length; i++) {
  byHypothesis[HYPOTHESES[i].key] = live[i] ?? null
}

const ranking = await agent(
  'Rank root causes by likelihood. Pick the top 3 with confidence and concrete next steps to confirm or fix.\\n\\n' +
    JSON.stringify({ triage, byHypothesis }, null, 2),
  {
    label: 'root cause ranking',
    schema: {
      type: 'object',
      properties: {
        topCauses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              hypothesis: { type: 'string' },
              likelihood: { type: 'string', enum: ['low', 'med', 'high'] },
              summary: { type: 'string' },
              nextStep: { type: 'string' },
            },
            required: ['hypothesis', 'likelihood', 'summary', 'nextStep'],
          },
        },
        immediateActions: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['topCauses', 'summary'],
    },
  },
)

const output = {
  ok: true,
  triage,
  ...(ranking ?? { topCauses: [], summary: 'ranking failed', immediateActions: [] }),
  byHypothesis,
}
return {
  summary: output.summary,
  sections: [
    { kind: 'risks', title: 'Top causes', items: output.topCauses.map((item) => ({ title: item.hypothesis, severity: item.likelihood, detail: item.summary, mitigation: item.nextStep })) },
    { kind: 'questions', title: 'Immediate actions', items: output.immediateActions ?? [] },
  ],
  structuredOutput: output,
}
`
