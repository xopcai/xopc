/**
 * Built-in workflow: `audit_repo`
 *
 * Fan-out repo audit. Phase 1 inventories the repo; phase 2 spawns N reviewers
 * in parallel, one per dimension (bugs / perf / security / tests / style);
 * phase 3 synthesises into a structured report. The script is kept readable so
 * users can copy it into `~/.xopc/workflows/` as a starting point.
 */

export const AUDIT_REPO_SCRIPT = `export const meta = {
  name: 'audit_repo',
  description: 'Fan-out repository audit across multiple dimensions, then synthesize a structured report.',
  whenToUse: 'User asks for a thorough / multi-dimension code review of the whole repo or a major subsystem.',
  phases: [
    { title: 'Inventory' },
    { title: 'Review' },
    { title: 'Synthesize' },
  ],
}

const DIMENSIONS = [
  { key: 'bugs', focus: 'Correctness bugs, null-safety, error handling, race conditions, off-by-one, dead code.' },
  { key: 'perf', focus: 'Performance issues, hot paths, N+1 patterns, accidental quadratic loops, sync I/O, missing caching.' },
  { key: 'security', focus: 'Auth/authz, input validation, secret handling, injection sinks, unsafe deserialization, SSRF.' },
  { key: 'tests', focus: 'Test coverage gaps, brittle tests, integration vs unit gaps, missing regression cases.' },
  { key: 'style', focus: 'Inconsistent conventions, naming, unused exports, duplication, layering violations.' },
]

phase('Inventory')
const inventory = await agent(
  'Produce a compact map of this repository: top-level layout, main modules, the 5–10 most important files, and any obvious entry points. Be terse and structured.',
  { label: 'repo inventory' },
)

phase('Review')
const findings = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(
      'Review the repository through the ' + d.key + ' lens.\\n' +
        'Focus: ' + d.focus + '\\n\\n' +
        'Inventory for orientation:\\n' + inventory + '\\n\\n' +
        'Return findings: file paths, line numbers when known, severity (low/med/high), a one-sentence why, a one-sentence fix.',
      {
        label: d.key + ' review',
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
  return { ok: true, summary: 'No findings.', byDimension: {} }
}
const byDimension = {}
for (let i = 0; i < DIMENSIONS.length; i++) {
  byDimension[DIMENSIONS[i].key] = live[i]?.findings ?? []
}

const summary = await agent(
  'Synthesize a compact report from these per-dimension findings. Deduplicate near-identical items. ' +
    'Order by severity (high → low). Cap at 20 entries. Return JSON.\\n\\n' +
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
        summary: { type: 'string' },
      },
      required: ['topFindings', 'summary'],
    },
  },
)

return { ok: true, ...(summary ?? { topFindings: [], summary: 'synthesis failed' }), byDimension }
`
