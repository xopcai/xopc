/**
 * Built-in workflow: `offer_design`
 *
 * Package skills and time into sellable offers — tiers, pricing, delivery
 * boundaries, and positioning for solopreneurs.
 *
 * Args:
 *   - skills: what you can do
 *   - audience: target customers
 *   - constraints: time or revenue goals (optional)
 */

export const OFFER_DESIGN_SCRIPT = `export const meta = {
  name: 'offer_design',
  description: 'Package your skills into sellable offers with tiers, pricing, boundaries, and positioning.',
  whenToUse: 'Solo operator turning expertise into productized services or subscription offers.',
  examplePrompts: [
    { field: 'skills', text: 'Notion systems, light automations, async consulting for creators' },
    { field: 'audience', text: 'Solo creators doing $3k–15k/month' },
  ],
  i18n: {
    zh: {
      description: '将个人能力打包为可售卖的产品/服务：层级、定价、交付边界与定位。',
      whenToUse: '超级个体想把专长产品化、设计报价与套餐时。',
      examplePrompts: [
        { field: 'skills', text: 'Notion 系统搭建、轻量自动化、面向创作者的异步咨询' },
        { field: 'audience', text: '月入 2–10 万的独立创作者' },
      ],
    },
  },
  tags: ['planning', 'architecture'],
  estimatedAgents: { min: 4, max: 5 },
  phases: [
    { title: 'Inventory' },
    { title: 'Package' },
    { title: 'Price' },
    { title: 'Position' },
  ],
}

const skills = args && typeof args === 'object' && args.skills
  ? String(args.skills)
  : 'Infer your skills from the most recent user turn.'

const audience = args && typeof args === 'object' && args.audience
  ? String(args.audience)
  : 'Infer target audience from context.'

const constraints = args && typeof args === 'object' && args.constraints
  ? String(args.constraints)
  : ''

phase('Inventory')
const inventory = await agent(
  'Inventory sellable capabilities for a solo operator. Separate high-leverage repeatable work from custom work. Note time sinks to avoid.\\n\\n' +
    'SKILLS:\\n' + skills + '\\nAUDIENCE:\\n' + audience +
    (constraints ? '\\nCONSTRAINTS:\\n' + constraints : ''),
  {
    label: 'inventory',
    schema: {
      type: 'object',
      properties: {
        coreCapabilities: { type: 'array', items: { type: 'string' } },
        repeatable: { type: 'array', items: { type: 'string' } },
        customOnly: { type: 'array', items: { type: 'string' } },
        avoid: { type: 'array', items: { type: 'string' } },
      },
      required: ['coreCapabilities', 'repeatable'],
    },
  },
)

phase('Package')
const packages = await agent(
  'Design 2–3 offer tiers (e.g. starter / core / premium) with clear deliverables, boundaries, and who each tier is for. Fit solo capacity — no fake scale.\\n\\n' +
    JSON.stringify({ skills, audience, constraints, inventory }, null, 2),
  {
    label: 'package',
    schema: {
      type: 'object',
      properties: {
        tiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              forWho: { type: 'string' },
              deliverables: { type: 'array', items: { type: 'string' } },
              boundaries: { type: 'array', items: { type: 'string' } },
              timeCommitment: { type: 'string' },
            },
            required: ['name', 'deliverables', 'boundaries'],
          },
        },
      },
      required: ['tiers'],
    },
  },
)

phase('Price')
const pricing = await agent(
  'Recommend pricing for each tier: price range, pricing model (fixed / retainer / subscription), rationale, and upsell path. Be realistic for solo operators.\\n\\n' +
    JSON.stringify({ audience, constraints, packages }, null, 2),
  {
    label: 'price',
    schema: {
      type: 'object',
      properties: {
        tiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              priceRange: { type: 'string' },
              model: { type: 'string' },
              rationale: { type: 'string' },
            },
            required: ['name', 'priceRange', 'model'],
          },
        },
        upsellPath: { type: 'string' },
      },
      required: ['tiers'],
    },
  },
)

phase('Position')
const positioning = await agent(
  'Write positioning: one-line value prop, differentiation vs DIY and vs agencies, ideal customer profile, and launch checklist (first 3 steps).\\n\\n' +
    JSON.stringify({ inventory, packages, pricing }, null, 2),
  {
    label: 'position',
    schema: {
      type: 'object',
      properties: {
        valueProp: { type: 'string' },
        differentiation: { type: 'array', items: { type: 'string' } },
        idealCustomer: { type: 'string' },
        launchChecklist: { type: 'array', items: { type: 'string' } },
      },
      required: ['valueProp', 'idealCustomer', 'launchChecklist'],
    },
  },
)

return {
  ok: true,
  inventory,
  packages,
  pricing,
  ...(positioning ?? { valueProp: 'positioning failed', launchChecklist: [] }),
}
`
