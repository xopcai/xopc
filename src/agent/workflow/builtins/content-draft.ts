/**
 * Built-in workflow: `content_draft`
 *
 * Multi-angle content drafting for non-code writing tasks — emails, posts,
 * announcements, docs, or messages. Fans out tone/audience angles in parallel,
 * then synthesizes a polished draft with variants.
 *
 * Args:
 *   - topic: what to write about
 *   - audience: who will read it (optional)
 *   - format: email | post | announcement | document | message (optional)
 */

export const CONTENT_DRAFT_SCRIPT = `export const meta = {
  name: 'content_draft',
  description: 'Draft polished content from multiple tone and audience angles, then synthesize the best version.',
  whenToUse: 'User needs help writing an email, post, announcement, doc section, or message — not code.',
  examplePrompts: [
    { field: 'topic', text: 'Write a product launch announcement for our mobile app update' },
    { field: 'topic', text: 'Draft a polite follow-up email after a missed meeting' },
  ],
  i18n: {
    zh: {
      description: '从多个语气与受众角度起草内容，并综合产出最佳版本。',
      whenToUse: '用户需要写邮件、帖子、公告、文档段落或消息等非代码内容时。',
      examplePrompts: [
        { field: 'topic', text: '写一份移动端应用更新的产品发布公告' },
        { field: 'topic', text: '起草一封错过会议后的礼貌跟进邮件' },
      ],
    },
  },
  tags: ['writing', 'content', 'communication'],
  estimatedAgents: { min: 4, max: 6 },
  phases: [
    { title: 'Brief' },
    { title: 'Angles' },
    { title: 'Draft' },
  ],
}

const topic = args && typeof args === 'object' && args.topic
  ? String(args.topic)
  : 'Infer the writing topic from the most recent user turn.'

const audience = args && typeof args === 'object' && args.audience
  ? String(args.audience)
  : 'general professional audience'

const format = args && typeof args === 'object' && args.format
  ? String(args.format)
  : 'document'

phase('Brief')
const brief = await agent(
  'Clarify this writing brief. Return the core message, constraints, tone guidance, and 3 distinct angles worth exploring (each with a hook and key point).\\n\\n' +
    'TOPIC:\\n' + topic + '\\nAUDIENCE:\\n' + audience + '\\nFORMAT:\\n' + format,
  {
    label: 'brief',
    schema: {
      type: 'object',
      properties: {
        coreMessage: { type: 'string' },
        tone: { type: 'string' },
        constraints: { type: 'array', items: { type: 'string' } },
        angles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              hook: { type: 'string' },
              keyPoint: { type: 'string' },
            },
            required: ['title', 'hook', 'keyPoint'],
          },
        },
      },
      required: ['coreMessage', 'angles'],
    },
  },
)

if (!brief || !brief.angles?.length) {
  return { ok: false, reason: 'briefing failed', topic, audience, format }
}

const angles = brief.angles.slice(0, 3)

phase('Angles')
const angleDrafts = await parallel(
  angles.map((a) => () =>
    agent(
      'Write a complete draft for this angle. Match the requested format and audience. Keep it ready to send or publish with minimal edits.\\n\\n' +
        'FORMAT: ' + format + '\\nAUDIENCE: ' + audience + '\\nCORE MESSAGE: ' + brief.coreMessage + '\\n' +
        'ANGLE: ' + a.title + '\\nHOOK: ' + a.hook + '\\nKEY POINT: ' + a.keyPoint,
      {
        label: a.title,
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            subject: { type: 'string' },
          },
          required: ['title', 'body'],
        },
      },
    ),
  ),
)

phase('Draft')
const live = angleDrafts.filter(Boolean)
const finalDraft = await agent(
  'Synthesize the best final draft from these angle-level versions. Pick the strongest hook and structure, merge the best lines, and remove redundancy. ' +
    'Return the polished draft plus a one-line rationale and two optional shorter variants (e.g. social / SMS length).\\n\\n' +
    JSON.stringify({ brief, drafts: live }, null, 2),
  {
    label: 'final draft',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        rationale: { type: 'string' },
        shortVariants: { type: 'array', items: { type: 'string' } },
      },
      required: ['body', 'rationale'],
    },
  },
)

return {
  ok: true,
  topic,
  audience,
  format,
  angleCount: angles.length,
  ...(finalDraft ?? { body: 'draft synthesis failed', rationale: '' }),
}
`
