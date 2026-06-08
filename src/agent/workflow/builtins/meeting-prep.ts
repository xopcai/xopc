/**
 * Built-in workflow: `meeting_prep`
 *
 * Prepares for a meeting by building context, an agenda, and talking points.
 * Useful for 1:1s, client calls, interviews, or team syncs — no code required.
 *
 * Args:
 *   - meeting_topic: what the meeting is about
 *   - attendees: who is involved (optional)
 *   - goal: desired outcome (optional)
 */

export const MEETING_PREP_SCRIPT = `export const meta = {
  name: 'meeting_prep',
  description: 'Build meeting context, a tight agenda, and prioritized talking points.',
  whenToUse: 'User has an upcoming meeting and wants prep — agenda, questions, and key messages.',
  examplePrompts: [
    { field: 'meeting_topic', text: 'Prep for a quarterly business review with leadership' },
    { field: 'meeting_topic', text: 'Prepare talking points for a vendor negotiation call' },
  ],
  i18n: {
    zh: {
      description: '整理会议背景、紧凑议程与优先发言要点。',
      whenToUse: '用户即将参加会议，需要议程、提问与关键信息准备时。',
      examplePrompts: [
        { field: 'meeting_topic', text: '准备与领导层的季度业务复盘会' },
        { field: 'meeting_topic', text: '准备供应商谈判电话的发言要点' },
      ],
    },
  },
  tags: ['meeting', 'productivity'],
  estimatedAgents: { min: 3, max: 5 },
  phases: [
    { title: 'Context' },
    { title: 'Agenda' },
    { title: 'Talking points' },
  ],
}

const meetingTopic = args && typeof args === 'object' && args.meeting_topic
  ? String(args.meeting_topic)
  : 'Infer the meeting topic from the most recent user turn.'

const attendees = args && typeof args === 'object' && args.attendees
  ? String(args.attendees)
  : 'not specified'

const goal = args && typeof args === 'object' && args.goal
  ? String(args.goal)
  : 'achieve a clear outcome and aligned next steps'

phase('Context')
const context = await agent(
  'Summarize meeting context. Identify stakeholder interests, likely tensions, information gaps, and success criteria.\\n\\n' +
    'MEETING:\\n' + meetingTopic + '\\nATTENDEES:\\n' + attendees + '\\nGOAL:\\n' + goal,
  {
    label: 'context',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        stakeholderInterests: { type: 'array', items: { type: 'string' } },
        tensions: { type: 'array', items: { type: 'string' } },
        informationGaps: { type: 'array', items: { type: 'string' } },
        successCriteria: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'successCriteria'],
    },
  },
)

phase('Agenda')
const agenda = await agent(
  'Draft a time-boxed agenda (30–60 min unless context suggests otherwise). Each item needs an owner hint and desired output. Prioritize decisions over status updates.\\n\\n' +
    JSON.stringify({ meetingTopic, attendees, goal, context }, null, 2),
  {
    label: 'agenda',
    schema: {
      type: 'object',
      properties: {
        durationMin: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              minutes: { type: 'number' },
              owner: { type: 'string' },
              output: { type: 'string' },
            },
            required: ['title', 'minutes', 'output'],
          },
        },
      },
      required: ['items'],
    },
  },
)

phase('Talking points')
const talkingPoints = await agent(
  'Produce prioritized talking points: opening line, 3–5 key messages, smart questions to ask, objections to anticipate with responses, and a crisp closing ask.\\n\\n' +
    JSON.stringify({ meetingTopic, context, agenda }, null, 2),
  {
    label: 'talking points',
    schema: {
      type: 'object',
      properties: {
        openingLine: { type: 'string' },
        keyMessages: { type: 'array', items: { type: 'string' } },
        questionsToAsk: { type: 'array', items: { type: 'string' } },
        objections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              objection: { type: 'string' },
              response: { type: 'string' },
            },
            required: ['objection', 'response'],
          },
        },
        closingAsk: { type: 'string' },
      },
      required: ['keyMessages', 'closingAsk'],
    },
  },
)

return {
  ok: true,
  meetingTopic,
  attendees,
  goal,
  context,
  agenda,
  talkingPoints,
}
`
