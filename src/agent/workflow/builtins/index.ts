import type { WorkflowDefinition, WorkflowDefinitionEstimatedAgents, WorkflowGraph } from '../../../workflows/domain/definition.js';
import { buildWorkflowDefinition } from '../../../workflows/domain/definition-utils.js';

interface BuiltinWorkflowSpec {
  name: string;
  title: string;
  zh: { title: string; description: string; whenToUse: string };
  description: string;
  whenToUse: string;
  tags: string[];
  perspectives: Array<{ title: string; focus: string }>;
}

const BUILTIN_SPECS: BuiltinWorkflowSpec[] = [
  {
    name: 'audit_repo',
    title: 'Repository Audit',
    zh: { title: '代码仓库审查', description: '全面审查代码仓库的架构、质量、安全与运维，输出按优先级排序的报告。', whenToUse: '适合全面检查代码仓库或核心子系统。' },
    description: 'Audit a repository across architecture, quality, security, and operations, then produce a prioritized report.',
    whenToUse: 'Use for a thorough review of a repository or major subsystem.',
    tags: ['code-review', 'audit'],
    perspectives: perspectives('Architecture and boundaries', 'Correctness and maintainability', 'Security and operations'),
  },
  {
    name: 'client_proposal',
    title: 'Client Proposal',
    zh: { title: '客户提案', description: '将客户需求整理为清晰的提案，涵盖范围、交付、定价依据与风险。', whenToUse: '适合准备面向客户的项目提案或工作说明书。' },
    description: 'Turn a client brief into a clear proposal covering scope, delivery, pricing logic, and risks.',
    whenToUse: 'Use when preparing a client-ready proposal or statement of work.',
    tags: ['writing', 'content', 'document'],
    perspectives: perspectives('Client goals and value', 'Scope and delivery plan', 'Commercial terms and risks'),
  },
  {
    name: 'competitor_scan',
    title: 'Competitor Scan',
    zh: { title: '竞品分析', description: '对比竞争产品，识别市场定位、定价与差异化机会。', whenToUse: '适合在市场定位、定价或产品推广决策前使用。' },
    description: 'Compare competitors and identify positioning, pricing, and differentiation opportunities.',
    whenToUse: 'Use before positioning, pricing, or go-to-market decisions.',
    tags: ['research', 'investigation'],
    perspectives: perspectives('Product and audience', 'Pricing and distribution', 'Differentiation and gaps'),
  },
  {
    name: 'content_draft',
    title: 'Content Draft',
    zh: { title: '内容起草', description: '从不同受众与语气角度起草内容，选出最合适的版本。', whenToUse: '适合撰写邮件、帖子、公告、文档等非代码内容。' },
    description: 'Draft polished content from multiple audience and tone perspectives, then select the strongest version.',
    whenToUse: 'Use for emails, posts, announcements, documentation, or other non-code writing.',
    tags: ['writing', 'content', 'communication'],
    perspectives: perspectives('Audience clarity', 'Narrative and tone', 'Conversion and call to action'),
  },
  {
    name: 'content_repurpose',
    title: 'Content Repurposing',
    zh: { title: '内容改编', description: '将一份素材改编为适合不同渠道的内容，保留核心信息。', whenToUse: '适合将已有素材用于多个平台。' },
    description: 'Turn one source into channel-specific content without losing the core message.',
    whenToUse: 'Use when adapting existing material for multiple platforms.',
    tags: ['writing', 'content'],
    perspectives: perspectives('Short social format', 'Professional long-form format', 'Video or newsletter format'),
  },
  {
    name: 'debug_incident',
    title: 'Incident Debugging',
    zh: { title: '故障排查', description: '通过独立假设排查故障，输出按可能性排序的原因与验证步骤。', whenToUse: '适合排查缺陷、崩溃、错误信息与异常行为。' },
    description: 'Triage an incident using independent hypotheses and produce ranked causes and verification steps.',
    whenToUse: 'Use for bugs, crashes, error messages, and unexpected behavior.',
    tags: ['debug', 'incident', 'troubleshooting'],
    perspectives: perspectives('Application behavior', 'Data and dependencies', 'Infrastructure and observability'),
  },
  {
    name: 'decision_compare',
    title: 'Decision Comparison',
    zh: { title: '方案对比', description: '依据多项独立标准对比备选方案，明确取舍并给出建议。', whenToUse: '适合在多个可行方案之间做决策。' },
    description: 'Compare options through independent criteria and recommend with explicit trade-offs.',
    whenToUse: 'Use for decisions with multiple viable choices.',
    tags: ['decision-making', 'comparison', 'productivity'],
    perspectives: perspectives('Benefits and upside', 'Risks and hidden cost', 'Fit with constraints'),
  },
  {
    name: 'implementation_plan',
    title: 'Implementation Plan',
    zh: { title: '实施计划', description: '将功能、重构或缺陷修复需求转化为可执行的实施计划。', whenToUse: '适合在修改多个文件或不熟悉的代码前使用。' },
    description: 'Convert a feature, refactor, or bugfix request into an actionable implementation plan.',
    whenToUse: 'Use before multi-file or unfamiliar code changes.',
    tags: ['planning', 'implementation', 'architecture'],
    perspectives: perspectives('Existing architecture', 'Implementation sequence', 'Testing and rollout risks'),
  },
  {
    name: 'inbox_triage',
    title: 'Inbox Triage',
    zh: { title: '收件箱整理', description: '将杂乱的消息与任务归为执行、委派、延后或舍弃，并明确优先级。', whenToUse: '适合从混杂的消息与任务中安排一天的工作。' },
    description: 'Sort messy inbox input into do, delegate, defer, and drop with clear priorities.',
    whenToUse: 'Use to plan a day from mixed messages and tasks.',
    tags: ['productivity', 'brainstorm'],
    perspectives: perspectives('Urgency and impact', 'Delegation and automation', 'Scheduling and elimination'),
  },
  {
    name: 'meeting_prep',
    title: 'Meeting Preparation',
    zh: { title: '会议准备', description: '整理会议背景、聚焦议程，以及按优先级排列的讨论要点。', whenToUse: '适合在重要会议前使用。' },
    description: 'Build meeting context, a focused agenda, and prioritized talking points.',
    whenToUse: 'Use before an important meeting.',
    tags: ['meeting', 'productivity'],
    perspectives: perspectives('Context and stakeholders', 'Agenda and decisions', 'Questions and key messages'),
  },
  {
    name: 'multi_perspective_review',
    title: 'Multi-Perspective Review',
    zh: { title: '多视角评审', description: '从用户、运营者与维护者的视角审视目标，发现潜在问题。', whenToUse: '适合在确定设计、计划、拉取请求或提案前使用。' },
    description: 'Stress-test a target from user, operator, and maintainer perspectives.',
    whenToUse: 'Use before committing to a design, plan, pull request, or proposal.',
    tags: ['review', 'planning', 'decision'],
    perspectives: perspectives('User experience and accessibility', 'Operational failure modes', 'Maintainability and hidden assumptions'),
  },
  {
    name: 'offer_design',
    title: 'Offer Design',
    zh: { title: '服务方案设计', description: '将专业能力打包为可销售的服务，明确分层、定价、边界与定位。', whenToUse: '适合设计标准化服务或订阅产品。' },
    description: 'Package expertise into sellable offers with tiers, pricing, boundaries, and positioning.',
    whenToUse: 'Use when productizing a service or subscription.',
    tags: ['planning', 'architecture'],
    perspectives: perspectives('Customer problem and task', 'Packaging and delivery boundaries', 'Pricing and positioning'),
  },
  {
    name: 'pr_review',
    title: 'Pull Request Review',
    zh: { title: '代码变更评审', description: '由多个专注不同领域的评审者检查代码变更，给出通过或阻止合入的结论。', whenToUse: '适合评审拉取请求、代码差异或一组提交。' },
    description: 'Review a change set with focused reviewers and produce a ship or block verdict.',
    whenToUse: 'Use for a pull request, diff, or commit range.',
    tags: ['code-review', 'pr'],
    perspectives: perspectives('Correctness and regressions', 'Security and performance', 'Tests and maintainability'),
  },
  {
    name: 'release_check',
    title: 'Release Readiness Check',
    zh: { title: '发布检查', description: '并行检查发布风险，评估就绪程度并给出是否发布的结论。', whenToUse: '适合在发布已完成的变更前使用。' },
    description: 'Assess release readiness through parallel risk checks and a go or no-go verdict.',
    whenToUse: 'Use before shipping a completed change.',
    tags: ['release', 'quality', 'validation'],
    perspectives: perspectives('Product behavior', 'Quality and regression risk', 'Operations and rollback'),
  },
  {
    name: 'research',
    title: 'Research',
    zh: { title: '专题研究', description: '从多个角度研究问题，综合结论并关注证据来源。', whenToUse: '适合需要独立调查的复杂问题。' },
    description: 'Research a question from multiple angles and produce a source-conscious synthesis.',
    whenToUse: 'Use for non-trivial questions that benefit from independent investigation.',
    tags: ['research', 'investigation'],
    perspectives: perspectives('Primary evidence and facts', 'Alternative explanations', 'Practical implications'),
  },
  {
    name: 'weekly_review',
    title: 'Weekly Review',
    zh: { title: '每周复盘', description: '回顾本周工作，为下周制定简短且有优先级的行动计划。', whenToUse: '适合每周复盘与计划安排。' },
    description: 'Review the week and produce a short, prioritized action plan for next week.',
    whenToUse: 'Use for a weekly retrospective and planning session.',
    tags: ['productivity', 'brainstorm'],
    perspectives: perspectives('Tasks and progress', 'Friction and unfinished work', 'Priorities and capacity'),
  },
];

export const BUILTIN_WORKFLOWS: readonly WorkflowDefinition[] = Object.freeze(
  BUILTIN_SPECS.map((spec) => createBuiltinWorkflow(spec)),
);

function createBuiltinWorkflow(spec: BuiltinWorkflowSpec): WorkflowDefinition {
  const graph = createParallelGraph(spec);
  const estimatedAgents: WorkflowDefinitionEstimatedAgents = {
    min: spec.perspectives.length + 1,
    max: spec.perspectives.length + 1,
  };
  return buildWorkflowDefinition({
    name: spec.name,
    source: 'builtin',
    graph,
    manifest: {
      title: spec.title,
      i18n: { zh: spec.zh },
      description: spec.description,
      whenToUse: spec.whenToUse,
      tags: spec.tags,
      estimatedAgents,
      inputSchema: { type: 'object', additionalProperties: true },
    },
    phases: [
      { id: 'explore', title: 'Explore' },
      { id: 'synthesize', title: 'Synthesize' },
    ],
  });
}

function createParallelGraph(spec: BuiltinWorkflowSpec): WorkflowGraph {
  const analystNodes = spec.perspectives.map((perspective, index) => ({
    id: `perspective-${index + 1}`,
    kind: 'agent' as const,
    title: perspective.title,
    description: perspective.focus,
    phaseId: 'explore',
    position: { x: 360, y: 80 + index * 180 },
    config: {
      prompt: `Goal: {{goal}}\nInput: {{input}}\n\nAnalyze this from the following perspective: ${perspective.focus}\nReturn concrete findings, evidence, risks, and recommended actions.`,
      maxIterations: 12,
    },
  }));
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'input', kind: 'input', title: 'User input', position: { x: 40, y: 260 }, config: {} },
      ...analystNodes,
      { id: 'merge', kind: 'merge', title: 'Combine findings', phaseId: 'synthesize', position: { x: 700, y: 260 }, config: { mode: 'object' } },
      {
        id: 'synthesis',
        kind: 'agent',
        title: 'Create final answer',
        phaseId: 'synthesize',
        position: { x: 980, y: 260 },
        config: {
          prompt: `Goal: {{goal}}\n\nIndependent findings:\n{{predecessors.merge}}\n\nSynthesize a decision-ready answer. Resolve conflicts, prioritize the most important points, and end with specific next actions.`,
          maxIterations: 12,
        },
      },
      { id: 'output', kind: 'output', title: 'Deliverable', position: { x: 1280, y: 260 }, config: {} },
    ],
    edges: [
      ...analystNodes.map((node, index) => ({ id: `input-${index + 1}`, source: 'input', target: node.id })),
      ...analystNodes.map((node, index) => ({ id: `perspective-${index + 1}-merge`, source: node.id, target: 'merge' })),
      { id: 'merge-synthesis', source: 'merge', target: 'synthesis' },
      { id: 'synthesis-output', source: 'synthesis', target: 'output' },
    ],
  };
}

function perspectives(first: string, second: string, third: string): Array<{ title: string; focus: string }> {
  return [first, second, third].map((title) => ({ title, focus: title }));
}
