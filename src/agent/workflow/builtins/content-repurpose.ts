/**
 * Built-in workflow: `content_repurpose`
 *
 * Repurpose one source piece into multi-platform formats — threads, LinkedIn,
 * short video script, newsletter blurb. For personal-brand solopreneurs.
 *
 * Args:
 *   - source: original article, notes, or talking points
 *   - platforms: target platforms (optional)
 */

export const CONTENT_REPURPOSE_SCRIPT = `export const meta = {
  name: 'content_repurpose',
  description: 'Repurpose one source into platform-specific content (threads, posts, scripts, newsletter).',
  whenToUse: 'User has existing content and wants multi-platform distribution without rewriting from scratch.',
  examplePrompts: [
    { field: 'source', text: '2000-word blog post on building a one-person AI business' },
    { field: 'platforms', text: 'X thread, LinkedIn, 60s video script, newsletter teaser' },
  ],
  i18n: {
    zh: {
      description: '将一份核心内容改编为多平台格式（推文串、领英帖、短视频脚本、Newsletter 摘要）。',
      whenToUse: '用户已有内容素材，需要一源多用、多平台分发时。',
      examplePrompts: [
        { field: 'source', text: '一篇 2000 字关于一人 AI 公司的博客' },
        { field: 'platforms', text: 'X 推文串、LinkedIn、60 秒口播稿、Newsletter 导语' },
      ],
    },
  },
  tags: ['writing', 'content'],
  estimatedAgents: { min: 4, max: 6 },
  phases: [
    { title: 'Extract' },
    { title: 'Adapt' },
    { title: 'Package' },
  ],
}

const source = args && typeof args === 'object' && args.source
  ? String(args.source)
  : 'Infer the source content from the most recent user turn.'

const platformsRaw = args && typeof args === 'object' && args.platforms
  ? String(args.platforms)
  : ''

const DEFAULT_PLATFORMS = [
  { id: 'x_thread', label: 'X / Twitter thread', format: '5–8 tweets, hook-first, one idea per tweet' },
  { id: 'linkedin', label: 'LinkedIn post', format: 'Professional post, 150–250 words, clear CTA' },
  { id: 'short_video', label: 'Short video script', format: '60-second spoken script with hook and CTA' },
  { id: 'newsletter', label: 'Newsletter teaser', format: 'Subject line + 2–3 sentence teaser + bullet highlights' },
]

phase('Extract')
const extracted = await agent(
  'Extract reusable content atoms from this source: core thesis, 3–5 key points, best quotes/stats, audience hook, and CTA.\\n\\nSOURCE:\\n' + source,
  {
    label: 'extract',
    schema: {
      type: 'object',
      properties: {
        thesis: { type: 'string' },
        keyPoints: { type: 'array', items: { type: 'string' } },
        hooks: { type: 'array', items: { type: 'string' } },
        quotesOrStats: { type: 'array', items: { type: 'string' } },
        cta: { type: 'string' },
      },
      required: ['thesis', 'keyPoints', 'cta'],
    },
  },
)

const targets = platformsRaw
  ? platformsRaw
      .split(/[,，\\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label, index) => ({
        id: 'custom_' + index,
        label,
        format: 'Native format and length for ' + label,
      }))
  : DEFAULT_PLATFORMS

phase('Adapt')
const adaptations = await parallel(
  targets.map((p) => () =>
    agent(
      'Adapt the extracted content for this platform. Match native tone and length. Return ready-to-publish copy.\\n\\n' +
        'PLATFORM: ' + p.label + '\\nFORMAT: ' + p.format + '\\n\\n' +
        JSON.stringify(extracted, null, 2),
      {
        label: p.label,
        schema: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            copy: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['platform', 'copy'],
        },
      },
    ),
  ),
)

phase('Package')
const packaged = await agent(
  'Package all platform adaptations with a publishing checklist: suggested order, cross-links between posts, and one optional bonus format (e.g. carousel outline).\\n\\n' +
    JSON.stringify({ extracted, adaptations: adaptations.filter(Boolean) }, null, 2),
  {
    label: 'package',
    schema: {
      type: 'object',
      properties: {
        publishingOrder: { type: 'array', items: { type: 'string' } },
        crossLinks: { type: 'array', items: { type: 'string' } },
        bonusFormat: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['publishingOrder', 'summary'],
    },
  },
)

const output = {
  ok: true,
  extracted,
  adaptations: adaptations.filter(Boolean),
  ...(packaged ?? { publishingOrder: [], summary: 'packaging failed' }),
}
return {
  summary: output.summary,
  sections: [
    { kind: 'questions', title: 'Publishing order', items: output.publishingOrder },
    { kind: 'questions', title: 'Cross-links', items: output.crossLinks ?? [] },
    { kind: 'json', title: 'Adaptations', value: output.adaptations },
  ],
  structuredOutput: output,
}
`
