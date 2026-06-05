/**
 * Built-in workflow: `release_check`
 *
 * Runs a release-readiness review for a finished change. It inspects the diff,
 * validates risk areas in parallel, and produces a go/no-go checklist.
 *
 * Args:
 *   - target: release candidate, branch, commit range, or feature summary
 *   - checks: optional subset of check keys
 */

export const RELEASE_CHECK_SCRIPT = `export const meta = {
  name: 'release_check',
  description: 'Assess whether a change is ready to release with parallel risk checks and a go/no-go verdict.',
  whenToUse: 'User is near the end of implementation and wants a release-quality readiness check before shipping.',
  tags: ['release', 'quality', 'validation'],
  estimatedAgents: { min: 6, max: 7 },
  phases: [
    { title: 'Scope' },
    { title: 'Checks' },
    { title: 'Verdict' },
  ],
}

const READ_ONLY_TOOLS = ['read_file', 'grep', 'find', 'list_dir', 'shell']

const target = args && typeof args === 'object' && args.target
  ? String(args.target)
  : 'Current working tree or release candidate from the conversation context.'

const ALL_CHECKS = [
  { key: 'regression', focus: 'Behavior changes, compatibility breaks, edge cases, and accidental scope creep.' },
  { key: 'tests', focus: 'Relevant automated tests, missing regression cases, flaky or weak assertions, and manual coverage gaps.' },
  { key: 'build', focus: 'Typecheck, lint, build, packaging, lazy imports, generated assets, and dependency correctness.' },
  { key: 'security', focus: 'Secrets, auth/authz, input validation, unsafe shell/file/network access, and data exposure.' },
  { key: 'ops', focus: 'Logging, observability, migrations, persistence, rollback, failure modes, and supportability.' },
]

let checks = ALL_CHECKS
if (args && typeof args === 'object' && Array.isArray(args.checks) && args.checks.length) {
  const selected = new Set(args.checks.map((check) => String(check)))
  checks = ALL_CHECKS.filter((check) => selected.has(check.key))
  if (!checks.length) checks = ALL_CHECKS
}

phase('Scope')
const scope = await agent(
  'Identify the release candidate scope. Inspect the working tree or target if useful. Return changed areas, user-visible behavior, and likely blast radius.\\n\\n' +
    'TARGET:\\n' + target,
  {
    label: 'release scope',
    toolset: READ_ONLY_TOOLS,
    schema: {
      type: 'object',
      properties: {
        changedAreas: { type: 'array', items: { type: 'string' } },
        userVisibleChanges: { type: 'array', items: { type: 'string' } },
        blastRadius: { type: 'string' },
      },
      required: ['changedAreas', 'blastRadius'],
    },
  },
)

phase('Checks')
const reports = await parallel(
  checks.map((check) => () =>
    agent(
      'Run a release-readiness check through the ' + check.key + ' lens.\\n' +
        'Focus: ' + check.focus + '\\n\\n' +
        'TARGET:\\n' + target + '\\n\\n' +
        'SCOPE:\\n' + JSON.stringify(scope, null, 2) + '\\n\\n' +
        'Return blockers, warnings, evidence, and concrete fixes. Prefer specific files/commands over generic statements.',
      {
        label: check.key + ' check',
        toolset: READ_ONLY_TOOLS,
        schema: {
          type: 'object',
          properties: {
            blockers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  evidence: { type: 'string' },
                  fix: { type: 'string' },
                },
                required: ['title', 'evidence', 'fix'],
              },
            },
            warnings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  evidence: { type: 'string' },
                  fix: { type: 'string' },
                },
                required: ['title', 'evidence'],
              },
            },
            recommendedCommands: { type: 'array', items: { type: 'string' } },
          },
          required: ['blockers', 'warnings'],
        },
      },
    ),
  ),
)

phase('Verdict')
const byCheck = {}
for (let i = 0; i < checks.length; i++) {
  byCheck[checks[i].key] = reports[i] ?? { blockers: [], warnings: [], recommendedCommands: [] }
}

const verdict = await agent(
  'Synthesize a release go/no-go verdict. Block if any credible blocker remains. If not blocked, distinguish ship_now from ship_after_checks. ' +
    'Deduplicate issues and produce the shortest checklist that would make this release safe.\\n\\n' +
    JSON.stringify({ target, scope, byCheck }, null, 2),
  {
    label: 'release verdict',
    schema: {
      type: 'object',
      properties: {
        recommendation: { type: 'string', enum: ['ship_now', 'ship_after_checks', 'block'] },
        summary: { type: 'string' },
        blockers: { type: 'array', items: { type: 'string' } },
        finalChecklist: { type: 'array', items: { type: 'string' } },
        commandsToRun: { type: 'array', items: { type: 'string' } },
      },
      required: ['recommendation', 'summary', 'blockers', 'finalChecklist'],
    },
  },
)

return {
  ok: true,
  target,
  checks: checks.map((check) => check.key),
  scope,
  ...(verdict ?? { recommendation: 'ship_after_checks', summary: 'verdict failed', blockers: [], finalChecklist: [] }),
  byCheck,
}
`
