/**
 * Built-in workflow: `research`
 *
 * Multi-modal research sweep on a question (args.question). Fans out search /
 * exploration / source-reading angles in parallel, then synthesises a cited
 * report. Each angle is its own subagent so source reading does not pollute the
 * parent context.
 */

export const RESEARCH_SCRIPT = `export const meta = {
  name: 'research',
  description: 'Multi-angle research on a question with parallel exploration and a cited synthesis.',
  whenToUse: 'User asks a non-trivial research question that benefits from multiple search angles or source reads.',
  phases: [
    { title: 'Frame' },
    { title: 'Sweep' },
    { title: 'Synthesize' },
  ],
}

const question = args && typeof args === 'object' && args.question
  ? String(args.question)
  : 'No explicit question supplied; infer from the most recent user turn.'

phase('Frame')
const frame = await agent(
  'Frame this research question. Return 3–5 distinct angles worth investigating, plus the single most decisive sub-question for each. Be concrete.\\n\\nQUESTION:\\n' +
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
  return { ok: false, reason: 'framing failed', question }
}

phase('Sweep')
const angleReports = await parallel(
  frame.angles.map((a) => () =>
    agent(
      'Investigate this angle. Use search and source-read tools liberally. Distinguish what you can confirm from what is conjecture.\\n\\n' +
        'ANGLE: ' + a.title + '\\n' +
        'KEY QUESTION: ' + a.key_question + '\\n\\n' +
        'Return: 3–6 grounded findings (each with a 1-line claim and a source URL or file path), plus the strongest counter-evidence.',
      {
        label: a.title,
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
    'Return: an executive summary (max 5 sentences), a bullet list of top findings with inline source URLs, and one section listing open questions.\\n\\n' +
    'QUESTION:\\n' + question + '\\n\\n' +
    JSON.stringify({ angles: frame.angles, reports: live }, null, 2),
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
      },
      required: ['executiveSummary', 'topFindings'],
    },
  },
)

return {
  ok: true,
  question,
  ...(synthesis ?? { executiveSummary: 'synthesis failed', topFindings: [] }),
}
`
