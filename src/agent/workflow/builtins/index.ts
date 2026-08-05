import type { WorkflowDefinition, WorkflowDefinitionEstimatedAgents, WorkflowGraph } from '../../../workflows/domain/definition.js';
import { buildWorkflowDefinition } from '../../../workflows/domain/definition-utils.js';

interface BuiltinWorkflowSpec {
  name: string;
  description: string;
  whenToUse: string;
  tags: string[];
  perspectives: Array<{ title: string; focus: string }>;
}

const BUILTIN_SPECS: BuiltinWorkflowSpec[] = [
  { name: 'audit_repo', description: 'Audit a repository across architecture, quality, security, and operations, then produce a prioritized report.', whenToUse: 'Use for a thorough review of a repository or major subsystem.', tags: ['code-review', 'audit'], perspectives: perspectives('Architecture and boundaries', 'Correctness and maintainability', 'Security and operations') },
  { name: 'client_proposal', description: 'Turn a client brief into a clear proposal covering scope, delivery, pricing logic, and risks.', whenToUse: 'Use when preparing a client-ready proposal or statement of work.', tags: ['writing', 'content', 'document'], perspectives: perspectives('Client goals and value', 'Scope and delivery plan', 'Commercial terms and risks') },
  { name: 'competitor_scan', description: 'Compare competitors and identify positioning, pricing, and differentiation opportunities.', whenToUse: 'Use before positioning, pricing, or go-to-market decisions.', tags: ['research', 'investigation'], perspectives: perspectives('Product and audience', 'Pricing and distribution', 'Differentiation and gaps') },
  { name: 'content_draft', description: 'Draft polished content from multiple audience and tone perspectives, then select the strongest version.', whenToUse: 'Use for emails, posts, announcements, documentation, or other non-code writing.', tags: ['writing', 'content', 'communication'], perspectives: perspectives('Audience clarity', 'Narrative and tone', 'Conversion and call to action') },
  { name: 'content_repurpose', description: 'Turn one source into channel-specific content without losing the core message.', whenToUse: 'Use when adapting existing material for multiple platforms.', tags: ['writing', 'content'], perspectives: perspectives('Short social format', 'Professional long-form format', 'Video or newsletter format') },
  { name: 'debug_incident', description: 'Triage an incident using independent hypotheses and produce ranked causes and verification steps.', whenToUse: 'Use for bugs, crashes, error messages, and unexpected behavior.', tags: ['debug', 'incident', 'troubleshooting'], perspectives: perspectives('Application behavior', 'Data and dependencies', 'Infrastructure and observability') },
  { name: 'decision_compare', description: 'Compare options through independent criteria and recommend with explicit trade-offs.', whenToUse: 'Use for decisions with multiple viable choices.', tags: ['decision-making', 'comparison', 'productivity'], perspectives: perspectives('Benefits and upside', 'Risks and hidden cost', 'Fit with constraints') },
  { name: 'implementation_plan', description: 'Convert a feature, refactor, or bugfix request into an actionable implementation plan.', whenToUse: 'Use before multi-file or unfamiliar code changes.', tags: ['planning', 'implementation', 'architecture'], perspectives: perspectives('Existing architecture', 'Implementation sequence', 'Testing and rollout risks') },
  { name: 'inbox_triage', description: 'Sort messy inbox input into do, delegate, defer, and drop with clear priorities.', whenToUse: 'Use to plan a day from mixed messages and tasks.', tags: ['productivity', 'brainstorm'], perspectives: perspectives('Urgency and impact', 'Delegation and automation', 'Scheduling and elimination') },
  { name: 'meeting_prep', description: 'Build meeting context, a focused agenda, and prioritized talking points.', whenToUse: 'Use before an important meeting.', tags: ['meeting', 'productivity'], perspectives: perspectives('Context and stakeholders', 'Agenda and decisions', 'Questions and key messages') },
  { name: 'multi_perspective_review', description: 'Stress-test a target from user, operator, and maintainer perspectives.', whenToUse: 'Use before committing to a design, plan, pull request, or proposal.', tags: ['review', 'planning', 'decision'], perspectives: perspectives('User experience and accessibility', 'Operational failure modes', 'Maintainability and hidden assumptions') },
  { name: 'offer_design', description: 'Package expertise into sellable offers with tiers, pricing, boundaries, and positioning.', whenToUse: 'Use when productizing a service or subscription.', tags: ['planning', 'architecture'], perspectives: perspectives('Customer problem and outcome', 'Packaging and delivery boundaries', 'Pricing and positioning') },
  { name: 'pr_review', description: 'Review a change set with focused reviewers and produce a ship or block verdict.', whenToUse: 'Use for a pull request, diff, or commit range.', tags: ['code-review', 'pr'], perspectives: perspectives('Correctness and regressions', 'Security and performance', 'Tests and maintainability') },
  { name: 'release_check', description: 'Assess release readiness through parallel risk checks and a go or no-go verdict.', whenToUse: 'Use before shipping a completed change.', tags: ['release', 'quality', 'validation'], perspectives: perspectives('Product behavior', 'Quality and regression risk', 'Operations and rollback') },
  { name: 'research', description: 'Research a question from multiple angles and produce a source-conscious synthesis.', whenToUse: 'Use for non-trivial questions that benefit from independent investigation.', tags: ['research', 'investigation'], perspectives: perspectives('Primary evidence and facts', 'Alternative explanations', 'Practical implications') },
  { name: 'weekly_review', description: 'Review the week and produce a short, prioritized action plan for next week.', whenToUse: 'Use for a weekly retrospective and planning session.', tags: ['productivity', 'brainstorm'], perspectives: perspectives('Outcomes and progress', 'Friction and unfinished work', 'Priorities and capacity') },
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
