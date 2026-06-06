/**
 * Built-in workflow: `research`
 *
 * Multi-modal research sweep on a question (args.question). Fans out search /
 * exploration / source-reading angles in parallel, then synthesises a cited
 * report. Each angle is its own subagent so source reading does not pollute the
 * parent context.
 *
 * Args:
 *   - question: research question
 *   - depth: 'quick' (2 angles) | 'standard' (4) | 'deep' (6)
 */

export const RESEARCH_SCRIPT = `export const meta = {
  name: 'research',
  description: 'Multi-angle research on a question with parallel exploration and a cited synthesis.',
  whenToUse: 'User asks a non-trivial research question that benefits from multiple search angles or source reads.',
  examplePrompts: [
    { field: 'question', text: 'Compare Bun vs Node startup performance' },
    { field: 'question', text: 'What are the trade-offs of SQLite vs Postgres for this app?' },
  ],
  i18n: {
    zh: {
      description: '多角度并行调研一个问题，并产出带引用的综合报告。',
      whenToUse: '用户提出需要多角度检索、阅读来源的非平凡调研问题时。',
      examplePrompts: [
        { field: 'question', text: '比较 Bun 与 Node 的启动性能' },
        { field: 'question', text: '这个应用用 SQLite 还是 Postgres 各有什么权衡？' },
      ],
    },
  },
  tags: ['research', 'investigation'],
  estimatedAgents: { min: 4, max: 8 },
  phases: [
    { title: 'Frame' },
    { title: 'Sweep' },
    { title: 'Synthesize' },
  ],
}

const RESEARCH_TOOLS = ['web_search', 'web_fetch', 'read_file', 'grep', 'find', 'list_dir']

const question = args && typeof args === 'object' && args.question
  ? String(args.question)
  : 'No explicit question supplied; infer from the most recent user turn.'

const depth = args && typeof args === 'object' && args.depth
  ? String(args.depth)
  : 'standard'
const maxAngles = depth === 'quick' ? 2 : depth === 'deep' ? 6 : 4

phase('Frame')
const frame = await agent(
  'Frame this research question. Return exactly ' + maxAngles + ' distinct angles worth investigating, ' +
    'each with the single most decisive sub-question. Be concrete.\\n\\nQUESTION:\\n' +
    question,
  {
    label: 'framing',
    schema: {
      type: 'object',
      properties: {
        angles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              key_question: { type: 'string' },
            },
            required: ['title', 'key_question'],
          },
        },
      },
      required: ['angles'],
    },
  },
)

if (!frame || !frame.angles?.length) {
  return { ok: false, reason: 'framing failed', question, depth }
}

const angles = frame.angles.slice(0, maxAngles)

phase('Sweep')
const angleReports = await parallel(
  angles.map((a) => () =>
    agent(
      'Investigate this angle. Use search and source-read tools liberally. Distinguish what you can confirm from what is conjecture.\\n\\n' +
        'ANGLE: ' + a.title + '\\n' +
        'KEY QUESTION: ' + a.key_question + '\\n\\n' +
        'Return: 3–6 grounded findings (each with a 1-line claim and a source URL or file path), plus the strongest counter-evidence.',
      {
        label: a.title,
        toolset: RESEARCH_TOOLS,
        maxIterations: depth === 'deep' ? 40 : 30,
        schema: {
          type: 'object',
          properties: {
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  claim: { type: 'string' },
                  source: { type: 'string' },
                  confidence: { type: 'string', enum: ['low', 'med', 'high'] },
                },
                required: ['claim', 'source', 'confidence'],
              },
            },
            counterEvidence: { type: 'string' },
          },
          required: ['findings'],
        },
      },
    ),
  ),
)

phase('Synthesize')
const live = angleReports.filter(Boolean)
const synthesis = await agent(
  'Synthesize a cited research report from these angle-level findings. Drop unsupported or duplicate claims. Use the highest-confidence source per claim. ' +
    'Explicitly list contradictions where angles disagree. Return: an executive summary (max 5 sentences), top findings with inline source URLs, open questions, and contradictions.\\n\\n' +
    'QUESTION:\\n' + question + '\\n\\n' +
    JSON.stringify({ angles, reports: live }, null, 2),
  {
    label: 'synthesis',
    schema: {
      type: 'object',
      properties: {
        executiveSummary: { type: 'string' },
        topFindings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              source: { type: 'string' },
            },
            required: ['claim', 'source'],
          },
        },
        openQuestions: { type: 'array', items: { type: 'string' } },
        contradictions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string' },
              sides: { type: 'array', items: { type: 'string' } },
            },
            required: ['topic', 'sides'],
          },
        },
      },
      required: ['executiveSummary', 'topFindings'],
    },
  },
)

return {
  ok: true,
  question,
  depth,
  angleCount: angles.length,
  ...(synthesis ?? { executiveSummary: 'synthesis failed', topFindings: [], contradictions: [] }),
}
`
