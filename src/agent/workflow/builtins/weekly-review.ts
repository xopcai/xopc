/**
 * Built-in workflow: `weekly_review`
 *
 * Weekly retrospective for solopreneurs — collect wins, blockers, and carryover,
 * then synthesize next-week priorities.
 *
 * Args:
 *   - wins: what went well this week
 *   - blockers: what stalled or frustrated progress
 *   - carryover: unfinished items (optional)
 */

export const WEEKLY_REVIEW_SCRIPT = `export const meta = {
  name: 'weekly_review',
  description: 'Review the week and produce 3–5 prioritized actions for next week.',
  whenToUse: 'Solo founder or super-individual doing a weekly retrospective and planning session.',
  examplePrompts: [
    { field: 'wins', text: 'Shipped landing page, got 2 demo calls, published one newsletter' },
    { field: 'blockers', text: 'Pricing still unclear, one client ghosted, distracted by side tasks' },
  ],
  i18n: {
    zh: {
      description: '复盘本周并产出下周 3–5 项优先行动。',
      whenToUse: '一人公司或超级个体做周复盘与下周规划时。',
      examplePrompts: [
        { field: 'wins', text: '上线了落地页、拿到 2 个 demo、发了一期 newsletter' },
        { field: 'blockers', text: '定价还不清晰、一个客户失联、被杂事分心' },
      ],
    },
  },
  tags: ['productivity', 'brainstorm'],
  estimatedAgents: { min: 3, max: 4 },
  phases: [
    { title: 'Collect' },
    { title: 'Analyze' },
    { title: 'Plan' },
  ],
}

const wins = args && typeof args === 'object' && args.wins
  ? String(args.wins)
  : 'Infer wins from the most recent user turn.'

const blockers = args && typeof args === 'object' && args.blockers
  ? String(args.blockers)
  : 'None specified — infer from context if possible.'

const carryover = args && typeof args === 'object' && args.carryover
  ? String(args.carryover)
  : ''

phase('Collect')
const collected = await agent(
  'Normalize this weekly input into structured facts: wins, blockers, carryover, energy level signals, and revenue/impact signals if mentioned. Be concise.\\n\\n' +
    'WINS:\\n' + wins + '\\nBLOCKERS:\\n' + blockers + '\\nCARRYOVER:\\n' + (carryover || '(none)'),
  {
    label: 'collect',
    schema: {
      type: 'object',
      properties: {
        wins: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } },
        carryover: { type: 'array', items: { type: 'string' } },
        themes: { type: 'array', items: { type: 'string' } },
      },
      required: ['wins', 'blockers'],
    },
  },
)

phase('Analyze')
const analysis = await agent(
  'Analyze this week for a solo operator. Identify patterns, root causes of blockers, what to stop doing, what to double down on, and one honest lesson.\\n\\n' +
    JSON.stringify(collected, null, 2),
  {
    label: 'analyze',
    schema: {
      type: 'object',
      properties: {
        patterns: { type: 'array', items: { type: 'string' } },
        rootCauses: { type: 'array', items: { type: 'string' } },
        stopDoing: { type: 'array', items: { type: 'string' } },
        doubleDown: { type: 'array', items: { type: 'string' } },
        lesson: { type: 'string' },
      },
      required: ['patterns', 'lesson'],
    },
  },
)

phase('Plan')
const plan = await agent(
  'Produce next week plan for a solo founder: exactly 3–5 prioritized actions (each with why, estimated effort, and success signal), plus one optional stretch goal. Be realistic for ~20–30 focused hours.\\n\\n' +
    JSON.stringify({ collected, analysis }, null, 2),
  {
    label: 'plan',
    schema: {
      type: 'object',
      properties: {
        priorities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              why: { type: 'string' },
              effort: { type: 'string', enum: ['low', 'med', 'high'] },
              successSignal: { type: 'string' },
            },
            required: ['action', 'why', 'successSignal'],
          },
        },
        stretchGoal: { type: 'string' },
        weeklyTheme: { type: 'string' },
      },
      required: ['priorities', 'weeklyTheme'],
    },
  },
)

return {
  ok: true,
  collected,
  analysis,
  ...(plan ?? { priorities: [], weeklyTheme: 'planning failed' }),
}
`
