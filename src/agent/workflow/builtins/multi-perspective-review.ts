/**
 * Built-in workflow: `multi_perspective_review`
 *
 * Reviews a target (file, PR, design doc, plan — passed via args.target) from
 * several independent perspectives, then asks an adversarial judge to decide
 * what would actually break in practice. Useful for sanity-checking decisions
 * before they ship.
 *
 * Args:
 *   - target: what to review
 *   - lenses: optional array of { name, angle } to override default lenses
 *   - skipAdversarial: when true, skip the adversarial judge phase
 */

export const MULTI_PERSPECTIVE_REVIEW_SCRIPT = `export const meta = {
  name: 'multi_perspective_review',
  description: 'Review a target from N independent perspectives, then adversarially judge what would actually break.',
  whenToUse: 'User wants a stress-test of a design, plan, PR, or proposal before committing to it.',
  examplePrompts: [
    { field: 'target', text: 'Stress-test this API redesign before we ship' },
    { field: 'target', text: 'Review the migration plan from multiple angles' },
  ],
  i18n: {
    zh: {
      description: '从多个独立视角评审目标，并由对抗性评审判断实际会出什么问题。',
      whenToUse: '用户想在落地前对设计、方案、PR 或提案做压力测试时。',
      examplePrompts: [
        { field: 'target', text: '上线前从多角度压力测试这个 API redesign' },
        { field: 'target', text: '从多个视角评审这份迁移方案' },
      ],
    },
  },
  tags: ['review', 'planning', 'decision'],
  estimatedAgents: { min: 5, max: 6 },
  phases: [
    { title: 'Lenses' },
    { title: 'Adversarial' },
    { title: 'Synthesize' },
  ],
}

const READ_ONLY_TOOLS = ['read_file', 'grep', 'find', 'list_dir']

const target = args && typeof args === 'object' && args.target
  ? String(args.target)
  : 'No explicit target was provided. Treat the currently focused file or recent context as the target.'

const skipAdversarial = Boolean(args && typeof args === 'object' && args.skipAdversarial)

const DEFAULT_LENSES = [
  { name: 'User', angle: 'How a real user experiences this. Friction, confusion, surprise paths, accessibility.' },
  { name: 'Operator', angle: 'How an on-call engineer experiences this in production. Failure modes, observability, rollback.' },
  { name: 'Skeptic', angle: 'Hidden assumptions. What is being implied but not stated. What would break under load or weird input.' },
  { name: 'Maintainer', angle: 'Six-month-later view. Clarity, naming, layering, ease of changing nearby code.' },
]

let lenses = DEFAULT_LENSES
if (args && typeof args === 'object' && Array.isArray(args.lenses) && args.lenses.length) {
  lenses = args.lenses
    .filter((l) => l && typeof l === 'object' && l.name && l.angle)
    .map((l) => ({ name: String(l.name), angle: String(l.angle) }))
  if (!lenses.length) lenses = DEFAULT_LENSES
}

phase('Lenses')
const lensViews = await parallel(
  lenses.map((l) => () =>
    agent(
      'Review the following target through the ' + l.name + ' lens.\\n' +
        'Lens focus: ' + l.angle + '\\n\\n' +
        'TARGET:\\n' + target + '\\n\\n' +
        'Return 3–7 concrete observations. Each entry: title (5–10 words), why-it-matters (1 sentence), risk (low/med/high).',
      {
        label: l.name + ' lens',
        toolset: READ_ONLY_TOOLS,
        schema: {
          type: 'object',
          properties: {
            observations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  why: { type: 'string' },
                  risk: { type: 'string', enum: ['low', 'med', 'high'] },
                },
                required: ['title', 'why', 'risk'],
              },
            },
          },
          required: ['observations'],
        },
      },
    ),
  ),
)

const valid = lensViews.filter(Boolean)
const allObs = valid.flatMap((v, i) =>
  (v?.observations ?? []).map((o) => ({ lens: lenses[i].name, ...o })),
)

let verdict = null
if (!skipAdversarial) {
  phase('Adversarial')
  verdict = await agent(
    'You are an adversarial judge. Given these multi-lens observations of a target, decide which would actually cause real harm if shipped as-is. ' +
      'Default to realRisk=false unless an observation has clear, mechanism-level evidence. ' +
      'Rate evidenceStrength as weak | moderate | strong.\\n\\n' +
      JSON.stringify(allObs, null, 2),
    {
      label: 'adversarial verdict',
      schema: {
        type: 'object',
        properties: {
          verdicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                lens: { type: 'string' },
                realRisk: { type: 'boolean' },
                evidenceStrength: { type: 'string', enum: ['weak', 'moderate', 'strong'] },
                reason: { type: 'string' },
              },
              required: ['title', 'lens', 'realRisk', 'evidenceStrength', 'reason'],
            },
          },
        },
        required: ['verdicts'],
      },
    },
  )
}

phase('Synthesize')
const confirmed = (verdict?.verdicts ?? []).filter((v) => v.realRisk)
const goNoGo = skipAdversarial
  ? (allObs.some((o) => o.risk === 'high') ? 'fix_first' : 'ship')
  : confirmed.some((v) => v.evidenceStrength === 'strong')
    ? 'fix_first'
    : confirmed.length
      ? 'fix_first'
      : 'ship'

return {
  ok: true,
  target,
  lenses: lenses.map((l) => l.name),
  skipAdversarial,
  observationCount: allObs.length,
  confirmedRiskCount: confirmed.length,
  goNoGo,
  topRisks: confirmed.slice(0, 10),
  allVerdicts: verdict?.verdicts ?? [],
}
`
