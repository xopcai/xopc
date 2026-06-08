/**
 * Built-in workflow: `inbox_triage`
 *
 * Triage messy inbox input — emails, messages, todos, ideas — into prioritized
 * action buckets for a solo operator with limited hours.
 *
 * Args:
 *   - inbox: pasted items to triage
 *   - priorities: this week's focus (optional)
 */

export const INBOX_TRIAGE_SCRIPT = `export const meta = {
  name: 'inbox_triage',
  description: 'Sort messy inbox input into today-must-do, delegate/automate, defer, and drop — with priorities.',
  whenToUse: 'Solo operator starting the day with emails, messages, and todos to sort in limited time.',
  examplePrompts: [
    { field: 'inbox', text: 'Client email re: deadline, newsletter idea, tax reminder, Slack ping, bug report' },
    { field: 'priorities', text: 'Ship v1 landing page and close one sales call this week' },
  ],
  i18n: {
    zh: {
      description: '将邮件、消息、待办等杂乱输入分拣为今日必做、可委派/自动化、延后、可删除，并排序。',
      whenToUse: '超级个体开工前需要理清信息、任务优先级，且时间有限时。',
      examplePrompts: [
        { field: 'inbox', text: '客户催进度邮件、newsletter 灵感、报税提醒、Slack @、一个 bug 反馈' },
        { field: 'priorities', text: '本周要上线 v1 落地页并完成一次销售通话' },
      ],
    },
  },
  tags: ['productivity', 'brainstorm'],
  estimatedAgents: { min: 3, max: 4 },
  phases: [
    { title: 'Classify' },
    { title: 'Prioritize' },
    { title: 'Action list' },
  ],
}

const inbox = args && typeof args === 'object' && args.inbox
  ? String(args.inbox)
  : 'Infer inbox items from the most recent user turn.'

const priorities = args && typeof args === 'object' && args.priorities
  ? String(args.priorities)
  : ''

phase('Classify')
const classified = await agent(
  'Classify each inbox item. Buckets: do_today, schedule_later, delegate_or_automate, drop, idea_parking. Extract implicit tasks and estimated minutes.\\n\\n' +
    'INBOX:\\n' + inbox + '\\nWEEKLY PRIORITIES:\\n' + (priorities || '(not specified)'),
  {
    label: 'classify',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              raw: { type: 'string' },
              bucket: {
                type: 'string',
                enum: ['do_today', 'schedule_later', 'delegate_or_automate', 'drop', 'idea_parking'],
              },
              task: { type: 'string' },
              minutes: { type: 'number' },
            },
            required: ['raw', 'bucket', 'task'],
          },
        },
      },
      required: ['items'],
    },
  },
)

phase('Prioritize')
const prioritized = await agent(
  'Prioritize do_today items for a solo operator with ~4–6 focused hours. Rank by impact vs effort. Flag conflicts with weekly priorities. Suggest what to batch.\\n\\n' +
    JSON.stringify({ priorities, classified }, null, 2),
  {
    label: 'prioritize',
    schema: {
      type: 'object',
      properties: {
        rankedToday: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task: { type: 'string' },
              rank: { type: 'number' },
              impact: { type: 'string', enum: ['low', 'med', 'high'] },
              reason: { type: 'string' },
            },
            required: ['task', 'rank', 'impact'],
          },
        },
        conflicts: { type: 'array', items: { type: 'string' } },
        batchSuggestions: { type: 'array', items: { type: 'string' } },
      },
      required: ['rankedToday'],
    },
  },
)

phase('Action list')
const actionList = await agent(
  'Produce a concrete action list: top 3 for today with time blocks, quick wins under 15 min, delegate/automate suggestions, and parking lot for ideas. End with one sentence focus theme for the day.\\n\\n' +
    JSON.stringify({ classified, prioritized }, null, 2),
  {
    label: 'action list',
    schema: {
      type: 'object',
      properties: {
        focusTheme: { type: 'string' },
        topThree: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task: { type: 'string' },
              timeBlock: { type: 'string' },
            },
            required: ['task'],
          },
        },
        quickWins: { type: 'array', items: { type: 'string' } },
        delegateOrAutomate: { type: 'array', items: { type: 'string' } },
        parkingLot: { type: 'array', items: { type: 'string' } },
      },
      required: ['focusTheme', 'topThree'],
    },
  },
)

return {
  ok: true,
  classified,
  prioritized,
  ...(actionList ?? { focusTheme: 'triage failed', topThree: [] }),
}
`
