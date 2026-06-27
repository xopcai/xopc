/**
 * Built-in workflow: `client_proposal`
 *
 * Draft a client-facing proposal from a brief — scope, timeline, pricing logic,
 * risks, and next steps. For freelancers, consultants, and solo service providers.
 *
 * Args:
 *   - client_brief: what the client wants
 *   - offer: what you provide
 *   - budget_hint: budget range or constraints (optional)
 */

export const CLIENT_PROPOSAL_SCRIPT = `export const meta = {
  name: 'client_proposal',
  description: 'Turn a client brief into a structured proposal with scope, timeline, pricing logic, and risks.',
  whenToUse: 'Freelancer or solo consultant needs a client-ready proposal or SOW draft.',
  examplePrompts: [
    { field: 'client_brief', text: 'SaaS startup wants 3-month growth consulting, budget 50–80k CNY' },
    { field: 'offer', text: 'Audit funnel, weekly strategy calls, async Slack support' },
  ],
  i18n: {
    zh: {
      description: '将客户需求转化为含范围、时间线、报价逻辑与风险说明的客户方案。',
      whenToUse: '自由职业者或独立顾问需要起草客户方案 / SOW 时。',
      examplePrompts: [
        { field: 'client_brief', text: 'SaaS 创业公司要 3 个月增长咨询，预算 5–8 万' },
        { field: 'offer', text: '漏斗审计、每周策略会、Slack 异步支持' },
      ],
    },
  },
  tags: ['writing', 'content', 'document'],
  estimatedAgents: { min: 4, max: 5 },
  phases: [
    { title: 'Understand' },
    { title: 'Structure' },
    { title: 'Draft' },
    { title: 'Polish' },
  ],
}

const clientBrief = args && typeof args === 'object' && args.client_brief
  ? String(args.client_brief)
  : 'Infer the client brief from the most recent user turn.'

const offer = args && typeof args === 'object' && args.offer
  ? String(args.offer)
  : 'Infer your offer from context.'

const budgetHint = args && typeof args === 'object' && args.budget_hint
  ? String(args.budget_hint)
  : ''

phase('Understand')
const understanding = await agent(
  'Extract client needs, implicit constraints, success criteria, red flags, and what is out of scope.\\n\\n' +
    'CLIENT BRIEF:\\n' + clientBrief + '\\nYOUR OFFER:\\n' + offer +
    (budgetHint ? '\\nBUDGET HINT:\\n' + budgetHint : ''),
  {
    label: 'understand',
    schema: {
      type: 'object',
      properties: {
        clientGoals: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
        successCriteria: { type: 'array', items: { type: 'string' } },
        redFlags: { type: 'array', items: { type: 'string' } },
        outOfScope: { type: 'array', items: { type: 'string' } },
      },
      required: ['clientGoals', 'successCriteria'],
    },
  },
)

phase('Structure')
const structure = await agent(
  'Design proposal structure: deliverables, milestones, timeline, pricing tiers or logic, assumptions, and exclusions. Fit a solo operator capacity.\\n\\n' +
    JSON.stringify({ clientBrief, offer, budgetHint, understanding }, null, 2),
  {
    label: 'structure',
    schema: {
      type: 'object',
      properties: {
        deliverables: { type: 'array', items: { type: 'string' } },
        milestones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              duration: { type: 'string' },
              output: { type: 'string' },
            },
            required: ['name', 'output'],
          },
        },
        pricingApproach: { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['deliverables', 'milestones', 'pricingApproach'],
    },
  },
)

phase('Draft')
const draft = await agent(
  'Write a client-ready proposal draft in professional but warm tone. Include executive summary, scope, timeline, pricing section (with rationale), risks, and next steps.\\n\\n' +
    JSON.stringify({ understanding, structure }, null, 2),
  {
    label: 'draft',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        executiveSummary: { type: 'string' },
        scope: { type: 'string' },
        timeline: { type: 'string' },
        pricing: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } },
        nextSteps: { type: 'array', items: { type: 'string' } },
      },
      required: ['executiveSummary', 'scope', 'pricing', 'nextSteps'],
    },
  },
)

phase('Polish')
const polished = await agent(
  'Polish the proposal: tighten language, add a one-line value prop, flag anything that could scare the client, and suggest 2 negotiation flex points.\\n\\n' +
    JSON.stringify(draft, null, 2),
  {
    label: 'polish',
    schema: {
      type: 'object',
      properties: {
        valueProp: { type: 'string' },
        fullProposal: { type: 'string' },
        clientConcerns: { type: 'array', items: { type: 'string' } },
        flexPoints: { type: 'array', items: { type: 'string' } },
      },
      required: ['valueProp', 'fullProposal'],
    },
  },
)

const output = {
  ok: true,
  understanding,
  structure,
  ...(polished ?? { valueProp: '', fullProposal: 'draft failed' }),
}
return {
  summary: output.valueProp || 'Proposal draft complete.',
  sections: [
    { kind: 'text', title: 'Proposal', content: output.fullProposal },
    { kind: 'questions', title: 'Client concerns', items: output.clientConcerns ?? [] },
    { kind: 'questions', title: 'Flex points', items: output.flexPoints ?? [] },
  ],
  structuredOutput: output,
}
`
