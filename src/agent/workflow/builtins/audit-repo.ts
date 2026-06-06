/**
 * Built-in workflow: `audit_repo`
 *
 * Fan-out repo audit. Phase 1 inventories the repo; phase 2 spawns N reviewers
 * in parallel, one per dimension (bugs / perf / security / tests / style);
 * phase 3 synthesises into a structured report. The script is kept readable so
 * users can copy it into `~/.xopc/workflows/` as a starting point.
 *
 * Args:
 *   - scope: subdirectory to focus on (default '.')
 *   - dimensions: subset of dimension keys, e.g. ['security', 'bugs']
 */

export const AUDIT_REPO_SCRIPT = `export const meta = {
  name: 'audit_repo',
  description: 'Fan-out repository audit across multiple dimensions, then synthesize a structured report.',
  whenToUse: 'User asks for a thorough / multi-dimension code review of the whole repo or a major subsystem.',
  examplePrompts: [
    { field: 'goal', text: 'Run a thorough audit of this repository' },
    { field: 'goal', text: 'Review code quality across the whole codebase' },
  ],
  i18n: {
    zh: {
      description: '多维度并行审查整个仓库，并汇总为结构化报告。',
      whenToUse: '用户需要对整库或主要子系统做全面、多维度的代码审查时。',
      examplePrompts: [
        { field: 'goal', text: '对整个仓库做一次全面审查' },
        { field: 'goal', text: '从代码质量维度审查整个代码库' },
      ],
    },
  },
  tags: ['code-review', 'audit'],
  estimatedAgents: { min: 7, max: 7 },
  phases: [
    { title: 'Inventory' },
    { title: 'Review' },
    { title: 'Synthesize' },
  ],
}

const READ_ONLY_TOOLS = ['read_file', 'grep', 'find', 'list_dir']

const scope = args && typeof args === 'object' && args.scope
  ? String(args.scope)
  : '.'

const ALL_DIMENSIONS = [
  { key: 'bugs', focus: 'Correctness bugs, null-safety, error handling, race conditions, off-by-one, dead code.' },
  { key: 'perf', focus: 'Performance issues, hot paths, N+1 patterns, accidental quadratic loops, sync I/O, missing caching.' },
  { key: 'security', focus: 'Auth/authz, input validation, secret handling, injection sinks, unsafe deserialization, SSRF.' },
  { key: 'tests', focus: 'Test coverage gaps, brittle tests, integration vs unit gaps, missing regression cases.' },
  { key: 'style', focus: 'Inconsistent conventions, naming, unused exports, duplication, layering violations.' },
]

let dimensions = ALL_DIMENSIONS
if (args && typeof args === 'object' && Array.isArray(args.dimensions) && args.dimensions.length) {
  const keys = new Set(args.dimensions.map((d) => String(d)))
  dimensions = ALL_DIMENSIONS.filter((d) => keys.has(d.key))
  if (!dimensions.length) dimensions = ALL_DIMENSIONS
}

phase('Inventory')
const inventory = await agent(
  'Produce a compact map of this repository scope: ' + scope + '. ' +
    'Cover layout, main modules, the 5–10 most important files, and obvious entry points. Be terse and structured.',
  { label: 'repo inventory', toolset: READ_ONLY_TOOLS },
)

phase('Review')
const findings = await parallel(
  dimensions.map((d) => () =>
    agent(
      'Review scope "' + scope + '" through the ' + d.key + ' lens.\\n' +
        'Focus: ' + d.focus + '\\n\\n' +
        'Inventory for orientation:\\n' + inventory + '\\n\\n' +
        'Return findings: file paths, line numbers when known, severity (low/med/high), a one-sentence why, a one-sentence fix.',
      {
        label: d.key + ' review',
        toolset: READ_ONLY_TOOLS,
        schema: {
          type: 'object',
          properties: {
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string' },
                  line: { type: ['number', 'string'] },
                  severity: { type: 'string', enum: ['low', 'med', 'high'] },
                  title: { type: 'string' },
                  fix: { type: 'string' },
                },
                required: ['file', 'severity', 'title', 'fix'],
              },
            },
          },
          required: ['findings'],
        },
      },
    ),
  ),
)

phase('Synthesize')
const live = findings.filter(Boolean)
if (!live.length) {
  return { ok: true, scope, summary: 'No findings.', byDimension: {}, priorityActions: [] }
}
const byDimension = {}
for (let i = 0; i < dimensions.length; i++) {
  byDimension[dimensions[i].key] = live[i]?.findings ?? []
}

const summary = await agent(
  'Synthesize a compact report from these per-dimension findings. Deduplicate near-identical items. ' +
    'Order by severity (high → low). Cap topFindings at 20. ' +
    'Also return priorityActions: the top 5 fixes ranked by impact, each with effort (S|M|L).\\n\\n' +
    JSON.stringify(byDimension, null, 2),
  {
    label: 'report synthesis',
    schema: {
      type: 'object',
      properties: {
        topFindings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dimension: { type: 'string' },
              file: { type: 'string' },
              severity: { type: 'string' },
              title: { type: 'string' },
              fix: { type: 'string' },
            },
            required: ['dimension', 'file', 'severity', 'title'],
          },
        },
        priorityActions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              severity: { type: 'string' },
              title: { type: 'string' },
              effort: { type: 'string', enum: ['S', 'M', 'L'] },
            },
            required: ['file', 'severity', 'title', 'effort'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['topFindings', 'priorityActions', 'summary'],
    },
  },
)

return {
  ok: true,
  scope,
  dimensions: dimensions.map((d) => d.key),
  ...(summary ?? { topFindings: [], priorityActions: [], summary: 'synthesis failed' }),
  byDimension,
}
`
