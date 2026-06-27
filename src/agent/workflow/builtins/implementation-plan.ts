/**
 * Built-in workflow: `implementation_plan`
 *
 * Turns a feature or refactor request into an actionable implementation plan.
 * It first frames the goal, then explores relevant code areas in parallel, and
 * finally synthesizes phased tasks with risks and validation steps.
 *
 * Args:
 *   - request: feature, bugfix, or refactor request
 *   - scope: optional repo path or subsystem hint
 */

export const IMPLEMENTATION_PLAN_SCRIPT = `export const meta = {
  name: 'implementation_plan',
  description: 'Create an actionable implementation plan from a feature, refactor, or bugfix request.',
  whenToUse: 'User wants a technical plan before coding, especially for multi-file or unfamiliar code changes.',
  examplePrompts: [
    { field: 'request', text: 'Plan a refactor of the session store' },
    { field: 'request', text: 'Design implementation steps for OAuth login' },
  ],
  i18n: {
    zh: {
      description: '将功能、重构或修复需求转化为可执行的实现计划。',
      whenToUse: '用户想在动手写代码前拿到技术方案，尤其是多文件或不熟悉代码的改动。',
      examplePrompts: [
        { field: 'request', text: '规划 session store 的重构步骤' },
        { field: 'request', text: '设计 OAuth 登录的实现步骤' },
      ],
    },
  },
  tags: ['planning', 'implementation', 'architecture'],
  estimatedAgents: { min: 5, max: 6 },
  phases: [
    { title: 'Frame' },
    { title: 'Explore' },
    { title: 'Plan' },
    { title: 'Validate' },
  ],
}

const READ_ONLY_TOOLS = ['read_file', 'grep', 'find', 'list_dir']

const request = args && typeof args === 'object' && args.request
  ? String(args.request)
  : 'Infer the implementation request from the current conversation context.'

const scope = args && typeof args === 'object' && args.scope
  ? String(args.scope)
  : '.'

phase('Frame')
const frame = await agent(
  'Frame this implementation request. Identify the desired outcome, non-goals, likely affected domains, and open questions. Be concrete and avoid generic advice.\\n\\n' +
    'REQUEST:\\n' + request + '\\n\\nSCOPE HINT:\\n' + scope,
  {
    label: 'request framing',
    toolset: READ_ONLY_TOOLS,
    schema: {
      type: 'object',
      properties: {
        outcome: { type: 'string' },
        nonGoals: { type: 'array', items: { type: 'string' } },
        affectedDomains: { type: 'array', items: { type: 'string' } },
        openQuestions: { type: 'array', items: { type: 'string' } },
      },
      required: ['outcome', 'affectedDomains'],
    },
  },
)

const AREAS = [
  { key: 'entrypoints', focus: 'Routes, commands, UI pages, public APIs, and user-facing surfaces that must change.' },
  { key: 'domain', focus: 'Core domain model, state transitions, stores, services, and invariants.' },
  { key: 'integration', focus: 'Cross-module dependencies, config, events, async jobs, persistence, and external APIs.' },
  { key: 'validation', focus: 'Existing tests, missing regression tests, build/type/lint commands, and release validation.' },
]

phase('Explore')
const explorations = await parallel(
  AREAS.map((area) => () =>
    agent(
      'Explore the repository for this implementation plan through the ' + area.key + ' lens.\\n' +
        'Focus: ' + area.focus + '\\n\\n' +
        'REQUEST:\\n' + request + '\\n\\n' +
        'FRAME:\\n' + JSON.stringify(frame, null, 2) + '\\n\\n' +
        'Return concrete files/functions/modules to inspect or modify, existing patterns to follow, and constraints that affect the plan.',
      {
        label: area.key + ' exploration',
        toolset: READ_ONLY_TOOLS,
        schema: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['path', 'reason'],
              },
            },
            patterns: { type: 'array', items: { type: 'string' } },
            constraints: { type: 'array', items: { type: 'string' } },
          },
          required: ['targets', 'constraints'],
        },
      },
    ),
  ),
)

phase('Plan')
const plan = await agent(
  'Synthesize an implementation plan from the framing and explorations. Make it executable by an engineer or coding agent. ' +
    'Use phased tasks, name the concrete files/modules, include sequencing/dependencies, and call out decisions that need user confirmation.\\n\\n' +
    JSON.stringify({ request, scope, frame, explorations }, null, 2),
  {
    label: 'plan synthesis',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        phases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              tasks: { type: 'array', items: { type: 'string' } },
              files: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'tasks'],
          },
        },
        decisions: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'phases', 'risks'],
    },
  },
)

phase('Validate')
const validation = await agent(
  'Create a validation checklist for this implementation plan. Include targeted tests, full commands, manual UI/API checks if relevant, and rollback/recovery notes.\\n\\n' +
    JSON.stringify({ request, plan }, null, 2),
  {
    label: 'validation checklist',
    toolset: READ_ONLY_TOOLS,
    schema: {
      type: 'object',
      properties: {
        testCommands: { type: 'array', items: { type: 'string' } },
        manualChecks: { type: 'array', items: { type: 'string' } },
        rollbackNotes: { type: 'array', items: { type: 'string' } },
      },
      required: ['testCommands', 'manualChecks'],
    },
  },
)

const output = {
  ok: true,
  request,
  scope,
  ...(plan ?? { summary: 'plan synthesis failed', phases: [], decisions: [], risks: [] }),
  validation: validation ?? { testCommands: [], manualChecks: [], rollbackNotes: [] },
}
return {
  summary: output.summary,
  sections: [
    { kind: 'json', title: 'Plan phases', value: output.phases },
    { kind: 'questions', title: 'Decisions', items: output.decisions ?? [] },
    { kind: 'risks', title: 'Risks', items: output.risks.map((title) => ({ title })) },
    { kind: 'json', title: 'Validation', value: output.validation },
  ],
  structuredOutput: output,
}
`
