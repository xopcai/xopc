/**
 * Built-in workflow: `multi_perspective_review`
 *
 * Reviews a target (file, PR, design doc, plan — passed via args.target) from
 * several independent perspectives, then asks an adversarial judge to decide
 * what would actually break in practice. Useful for sanity-checking decisions
 * before they ship.
 */

export const MULTI_PERSPECTIVE_REVIEW_SCRIPT = `export const meta = {
  name: 'multi_perspective_review',
  description: 'Review a target from N independent perspectives, then adversarially judge what would actually break.',
  whenToUse: 'User wants a stress-test of a design, plan, PR, or proposal before committing to it.',
  phases: [
    { title: 'Lenses' },
    { title: 'Adversarial' },
    { title: 'Synthesize' },
  ],
}

const target = args && typeof args === 'object' && args.target
  ? String(args.target)
  : 'No explicit target was provided. Treat the currently focused file or recent context as the target.'

const LENSES = [
  { name: 'User',         angle: 'How a real user experiences this. Friction, confusion, surprise paths, accessibility.' },
  { name: 'Operator',     angle: 'How an on-call engineer experiences this in production. Failure modes, observability, rollback.' },
  { name: 'Skeptic',      angle: 'Hidden assumptions. What is being implied but not stated. What would break under load or weird input.' },
  { name: 'Maintainer',   angle: 'Six-month-later view. Clarity, naming, layering, ease of changing nearby code.' },
]

phase('Lenses')
const lensViews = await parallel(
  LENSES.map((l) => () =>
    agent(
      'Review the following target through the ' + l.name + ' lens.\\n' +
        'Lens focus: ' + l.angle + '\\n\\n' +
        'TARGET:\\n' + target + '\\n\\n' +
        'Return 3–7 concrete observations. Each entry: title (5–10 words), why-it-matters (1 sentence), risk (low/med/high).',
      {
        label: l.name + ' lens',
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

phase('Adversarial')
const valid = lensViews.filter(Boolean)
const allObs = valid.flatMap((v, i) =>
  (v?.observations ?? []).map((o) => ({ lens: LENSES[i].name, ...o })),
)

const verdict = await agent(
  'You are an adversarial judge. Given these multi-lens observations of a target, decide which would actually cause real harm if shipped as-is. ' +
    'Default to refuted=true unless an observation has clear, mechanism-level evidence.\\n\\n' +
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
              reason: { type: 'string' },
            },
            required: ['title', 'lens', 'realRisk', 'reason'],
          },
        },
      },
      required: ['verdicts'],
    },
  },
)

phase('Synthesize')
const confirmed = (verdict?.verdicts ?? []).filter((v) => v.realRisk)
return {
  ok: true,
  target,
  observationCount: allObs.length,
  confirmedRiskCount: confirmed.length,
  topRisks: confirmed.slice(0, 10),
  allVerdicts: verdict?.verdicts ?? [],
}
`
