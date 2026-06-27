/**
 * Built-in workflow: `pr_review`
 *
 * Focused review of a PR, diff, or commit range — lighter than full repo audit.
 * Parallel reviewers cover correctness, security, tests, API compat, and perf;
 * final phase produces a ship/block verdict with blockers vs suggestions.
 *
 * Args:
 *   - target: PR description, diff, commit range, or file list
 *   - diff: alias for target
 */

export const PR_REVIEW_SCRIPT = `export const meta = {
  name: 'pr_review',
  description: 'Review a PR/diff/commit range with parallel focused reviewers and a ship/block verdict.',
  whenToUse: 'User asks to review a PR, diff, specific changes, or commit range (not the whole repo).',
  examplePrompts: [
    { field: 'target', text: 'Review the changes on this branch' },
    { field: 'target', text: 'Review PR #42 for ship/block verdict' },
  ],
  i18n: {
    zh: {
      description: '并行聚焦审查 PR、diff 或提交范围，并给出可合并/应拦截的结论。',
      whenToUse: '用户要审查 PR、diff、特定改动或提交范围（而非整库）时。',
      examplePrompts: [
        { field: 'target', text: '审查当前分支上的改动' },
        { field: 'target', text: '审查 PR #42，给出是否可合并的结论' },
      ],
    },
  },
  tags: ['code-review', 'pr'],
  estimatedAgents: { min: 7, max: 7 },
  phases: [
    { title: 'Scope' },
    { title: 'Review' },
    { title: 'Verdict' },
  ],
}

const READ_ONLY_TOOLS = ['read_file', 'grep', 'find', 'list_dir', 'shell']

const target = args && typeof args === 'object'
  ? String(args.target ?? args.diff ?? '')
  : ''
const reviewTarget = target.trim()
  ? target
  : 'Recent changes in the working tree or the diff/context from the current conversation.'

const REVIEWERS = [
  { key: 'correctness', focus: 'Logic bugs, edge cases, error handling, null safety, race conditions in changed code.' },
  { key: 'security', focus: 'Auth/authz regressions, input validation, secret exposure, injection, unsafe deserialization in the diff.' },
  { key: 'tests', focus: 'Missing tests for changed behavior, brittle assertions, untested edge cases introduced by this change.' },
  { key: 'api_compat', focus: 'Breaking public API changes, schema migrations, backward compatibility, deprecation handling.' },
  { key: 'perf', focus: 'Regressions in hot paths, accidental N+1, sync I/O, unbounded loops or allocations in changed code.' },
]

phase('Scope')
const scope = await agent(
  'Identify what changed for this review target. List changed files, blast radius (what depends on them), and the apparent intent of the change. Be concise.\\n\\nTARGET:\\n' +
    reviewTarget,
  {
    label: 'change scope',
    toolset: READ_ONLY_TOOLS,
    schema: {
      type: 'object',
      properties: {
        changedFiles: { type: 'array', items: { type: 'string' } },
        intent: { type: 'string' },
        blastRadius: { type: 'string' },
      },
      required: ['changedFiles', 'intent'],
    },
  },
)

phase('Review')
const reviews = await parallel(
  REVIEWERS.map((r) => () =>
    agent(
      'Review these changes through the ' + r.key + ' lens.\\n' +
        'Focus: ' + r.focus + '\\n\\n' +
        'TARGET:\\n' + reviewTarget + '\\n\\n' +
        'SCOPE:\\n' + JSON.stringify(scope, null, 2) + '\\n\\n' +
        'Return findings: file, severity (low/med/high/blocker), title, fix suggestion. Blocker = must fix before merge.',
      {
        label: r.key,
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
                  severity: { type: 'string', enum: ['low', 'med', 'high', 'blocker'] },
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

phase('Verdict')
const live = reviews.filter(Boolean)
const byReviewer = {}
for (let i = 0; i < REVIEWERS.length; i++) {
  byReviewer[REVIEWERS[i].key] = live[i]?.findings ?? []
}

const verdict = await agent(
  'Synthesize a PR review verdict. Separate blockers from suggestions. Deduplicate. Recommend ship | fix_first | block.\\n\\n' +
    JSON.stringify(byReviewer, null, 2),
  {
    label: 'verdict',
    schema: {
      type: 'object',
      properties: {
        recommendation: { type: 'string', enum: ['ship', 'fix_first', 'block'] },
        summary: { type: 'string' },
        blockers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              title: { type: 'string' },
              fix: { type: 'string' },
            },
            required: ['file', 'title'],
          },
        },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              severity: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['file', 'title'],
          },
        },
      },
      required: ['recommendation', 'summary', 'blockers'],
    },
  },
)

const output = {
  ok: true,
  target: reviewTarget,
  scope,
  ...(verdict ?? { recommendation: 'fix_first', summary: 'verdict failed', blockers: [], suggestions: [] }),
  byReviewer,
}
return {
  summary: output.summary,
  sections: [
    { kind: 'findings', title: 'Blockers', items: output.blockers.map((item) => ({ title: item.title, severity: 'high', file: item.file, detail: item.fix })) },
    { kind: 'findings', title: 'Suggestions', items: output.suggestions.map((item) => ({ title: item.title, severity: item.severity, file: item.file })) },
  ],
  structuredOutput: output,
}
`
