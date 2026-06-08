/**
 * Built-in workflow: `decision_compare`
 *
 * Structured comparison of options for everyday decisions — vendors, approaches,
 * purchases, policies, or life choices. Independent evaluators score each option,
 * then a synthesizer recommends with trade-offs spelled out.
 *
 * Args:
 *   - question: the decision to make
 *   - options: optional comma-separated or newline-separated option list
 *   - criteria: optional evaluation criteria hint
 */

export const DECISION_COMPARE_SCRIPT = `export const meta = {
  name: 'decision_compare',
  description: 'Compare options across independent evaluators, then recommend with explicit trade-offs.',
  whenToUse: 'User faces a non-code decision with multiple viable options and wants a structured comparison.',
  examplePrompts: [
    { field: 'question', text: 'Which project management tool fits a 5-person remote team?' },
    { field: 'question', text: 'Should we host the event in-person, hybrid, or fully virtual?' },
  ],
  i18n: {
    zh: {
      description: '由多个独立评审维度对比选项，并给出含权衡的推荐结论。',
      whenToUse: '用户面临多个可行方案的非代码决策，需要结构化对比时。',
      examplePrompts: [
        { field: 'question', text: '5 人远程团队适合用哪款项目管理工具？' },
        { field: 'question', text: '活动应该线下、混合还是纯线上举办？' },
      ],
    },
  },
  tags: ['decision-making', 'comparison', 'productivity'],
  estimatedAgents: { min: 4, max: 7 },
  phases: [
    { title: 'Frame' },
    { title: 'Evaluate' },
    { title: 'Recommend' },
  ],
}

const question = args && typeof args === 'object' && args.question
  ? String(args.question)
  : 'Infer the decision question from the most recent user turn.'

const optionsRaw = args && typeof args === 'object' && args.options
  ? String(args.options)
  : ''

const criteriaHint = args && typeof args === 'object' && args.criteria
  ? String(args.criteria)
  : ''

phase('Frame')
const frame = await agent(
  'Frame this decision. If options are not provided, propose 3–4 realistic options. Return evaluation criteria (weighted if helpful), assumptions, and non-goals.\\n\\n' +
    'QUESTION:\\n' + question + '\\n' +
    (optionsRaw ? 'OPTIONS:\\n' + optionsRaw + '\\n' : '') +
    (criteriaHint ? 'CRITERIA HINT:\\n' + criteriaHint + '\\n' : ''),
  {
    label: 'framing',
    schema: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              summary: { type: 'string' },
            },
            required: ['name', 'summary'],
          },
        },
        criteria: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              weight: { type: 'string', enum: ['low', 'med', 'high'] },
            },
            required: ['name'],
          },
        },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['options', 'criteria'],
    },
  },
)

if (!frame || !frame.options?.length) {
  return { ok: false, reason: 'framing failed', question }
}

const options = frame.options.slice(0, 4)
const criteria = frame.criteria ?? []

const LENSES = [
  { name: 'Benefits', focus: 'Upside, value delivered, and who wins.' },
  { name: 'Risks', focus: 'Downside, failure modes, hidden costs, and regrets.' },
  { name: 'Fit', focus: 'Fit for stated constraints, audience, timeline, and resources.' },
]

phase('Evaluate')
const evaluations = await parallel(
  LENSES.map((lens) => () =>
    agent(
      'Evaluate every option through this lens. Be specific — avoid generic pros/cons. Score each option low/med/high for this lens with a one-line rationale.\\n\\n' +
        'LENS: ' + lens.name + ' — ' + lens.focus + '\\n' +
        'QUESTION: ' + question + '\\n' +
        'OPTIONS:\\n' + JSON.stringify(options, null, 2) + '\\n' +
        'CRITERIA:\\n' + JSON.stringify(criteria, null, 2),
      {
        label: lens.name,
        schema: {
          type: 'object',
          properties: {
            lens: { type: 'string' },
            scores: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  option: { type: 'string' },
                  score: { type: 'string', enum: ['low', 'med', 'high'] },
                  rationale: { type: 'string' },
                },
                required: ['option', 'score', 'rationale'],
              },
            },
          },
          required: ['lens', 'scores'],
        },
      },
    ),
  ),
)

phase('Recommend')
const live = evaluations.filter(Boolean)
const recommendation = await agent(
  'Recommend the best option (or a hybrid) from these lens-level evaluations. State trade-offs explicitly, note what would change the recommendation, and give a runner-up.\\n\\n' +
    'QUESTION:\\n' + question + '\\n\\n' +
    JSON.stringify({ frame, evaluations: live }, null, 2),
  {
    label: 'recommendation',
    schema: {
      type: 'object',
      properties: {
        recommendation: { type: 'string' },
        rationale: { type: 'string' },
        tradeoffs: { type: 'array', items: { type: 'string' } },
        runnerUp: { type: 'string' },
        whatWouldChange: { type: 'array', items: { type: 'string' } },
      },
      required: ['recommendation', 'rationale', 'tradeoffs'],
    },
  },
)

return {
  ok: true,
  question,
  optionCount: options.length,
  ...(recommendation ?? { recommendation: 'recommendation failed', rationale: '', tradeoffs: [] }),
}
`
