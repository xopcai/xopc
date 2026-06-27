/**
 * Built-in workflow: `competitor_scan`
 *
 * Parallel competitor scan for solopreneurs — positioning, pricing, strengths,
 * weaknesses, and differentiation opportunities.
 *
 * Args:
 *   - market: what you are building or selling
 *   - competitors: competitor names (optional)
 *   - focus: what you care most about (optional)
 */

export const COMPETITOR_SCAN_SCRIPT = `export const meta = {
  name: 'competitor_scan',
  description: 'Scan competitors in parallel and synthesize positioning, pricing, and differentiation opportunities.',
  whenToUse: 'Solo founder comparing alternatives before pricing, positioning, or go-to-market decisions.',
  examplePrompts: [
    { field: 'market', text: 'AI writing assistant for solo creators' },
    { field: 'competitors', text: 'Notion AI, Jasper, Cursor' },
  ],
  i18n: {
    zh: {
      description: '并行扫描竞品，综合定位、定价与差异化机会。',
      whenToUse: '一人公司在定价、定位或进入市场前需要竞品对比时。',
      examplePrompts: [
        { field: 'market', text: '面向独立创作者的 AI 写作助手' },
        { field: 'competitors', text: 'Notion AI、Jasper、Cursor' },
      ],
    },
  },
  tags: ['research', 'investigation'],
  estimatedAgents: { min: 4, max: 7 },
  phases: [
    { title: 'Frame' },
    { title: 'Scan' },
    { title: 'Synthesize' },
  ],
}

const RESEARCH_TOOLS = ['web_search', 'web_fetch']

const market = args && typeof args === 'object' && args.market
  ? String(args.market)
  : 'Infer the market from the most recent user turn.'

const competitorsRaw = args && typeof args === 'object' && args.competitors
  ? String(args.competitors)
  : ''

const focus = args && typeof args === 'object' && args.focus
  ? String(args.focus)
  : 'positioning and pricing'

phase('Frame')
const frame = await agent(
  'Frame this competitor scan. If competitors are not listed, propose 3–4 realistic competitors. Return scan criteria and your assumed buyer persona.\\n\\n' +
    'MARKET:\\n' + market + '\\n' +
    (competitorsRaw ? 'COMPETITORS:\\n' + competitorsRaw + '\\n' : '') +
    'FOCUS:\\n' + focus,
  {
    label: 'frame',
    toolset: RESEARCH_TOOLS,
    schema: {
      type: 'object',
      properties: {
        competitors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              oneLiner: { type: 'string' },
            },
            required: ['name'],
          },
        },
        criteria: { type: 'array', items: { type: 'string' } },
        buyerPersona: { type: 'string' },
      },
      required: ['competitors', 'criteria'],
    },
  },
)

if (!frame || !frame.competitors?.length) {
  const output = { ok: false, reason: 'framing failed', market }
  return {
    summary: output.reason,
    sections: [{ kind: 'json', title: 'Scan framing', value: output }],
    structuredOutput: output,
  }
}

const competitors = frame.competitors.slice(0, 4)

phase('Scan')
const scans = await parallel(
  competitors.map((c) => () =>
    agent(
      'Research this competitor for a solo founder. Use web search. Return positioning, pricing model, strengths, weaknesses, and target customer — cite sources where possible.\\n\\n' +
        'COMPETITOR: ' + c.name + '\\nMARKET: ' + market + '\\nFOCUS: ' + focus,
      {
        label: c.name,
        toolset: RESEARCH_TOOLS,
        maxIterations: 25,
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            positioning: { type: 'string' },
            pricing: { type: 'string' },
            strengths: { type: 'array', items: { type: 'string' } },
            weaknesses: { type: 'array', items: { type: 'string' } },
            targetCustomer: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'positioning', 'strengths', 'weaknesses'],
        },
      },
    ),
  ),
)

phase('Synthesize')
const synthesis = await agent(
  'Synthesize a competitor matrix and differentiation playbook for a one-person company. Include whitespace opportunities, pricing band recommendation, and 3 positioning angles to test.\\n\\n' +
    JSON.stringify({ market, focus, frame, scans: scans.filter(Boolean) }, null, 2),
  {
    label: 'synthesis',
    schema: {
      type: 'object',
      properties: {
        matrixSummary: { type: 'string' },
        whitespace: { type: 'array', items: { type: 'string' } },
        pricingBand: { type: 'string' },
        positioningAngles: { type: 'array', items: { type: 'string' } },
        avoidCompetingOn: { type: 'array', items: { type: 'string' } },
      },
      required: ['matrixSummary', 'whitespace', 'positioningAngles'],
    },
  },
)

const output = {
  ok: true,
  market,
  competitorCount: competitors.length,
  scans: scans.filter(Boolean),
  ...(synthesis ?? { matrixSummary: 'synthesis failed', whitespace: [], positioningAngles: [] }),
}
return {
  summary: output.matrixSummary,
  sections: [
    { kind: 'questions', title: 'Whitespace opportunities', items: output.whitespace },
    { kind: 'questions', title: 'Positioning angles', items: output.positioningAngles },
    { kind: 'json', title: 'Competitor scans', value: output.scans },
  ],
  structuredOutput: output,
}
`
