import { randomUUID } from 'node:crypto';

import type { ConfirmedWork, MonitoringMode, WorkIntakeProposal } from '@xopcai/gateway-contract';

import { GoalService } from '../goals/index.js';
import { ProjectService, type Project } from '../projects/index.js';
import {
  getSessionMetadata,
  runSqliteWriteTransaction,
} from '../storage/sqlite/index.js';
import { WorkItemService } from '../work-items/index.js';
import { ProjectMonitoringService } from './project-monitoring-service.js';

const INTAKE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_NEXT_ACTION = 'Clarify the scope and complete the first verifiable step.';

type StoredProposal = WorkIntakeProposal & { sessionKey?: string; agentId?: string };

function compactTitle(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const firstSentence = firstLine.split(/[.!?。！？]/, 1)[0]?.trim() ?? firstLine;
  return (firstSentence || 'New work').slice(0, 80);
}

function projectScore(project: Project, objective: string): number {
  const query = objective.toLocaleLowerCase();
  const name = project.name.toLocaleLowerCase();
  let score = query.includes(name) ? 10 : 0;
  const tokens = name.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
  score += tokens.filter((token) => query.includes(token)).length * 2;
  if (project.description && query.includes(project.description.toLocaleLowerCase())) score += 2;
  return score;
}

export class WorkIntakeService {
  readonly #proposals = new Map<string, StoredProposal>();
  readonly #goals = new GoalService();
  readonly #monitoring = new ProjectMonitoringService();

  constructor(
    private readonly projects: ProjectService,
    private readonly workItems: WorkItemService,
  ) {}

  propose(input: {
    objective: string;
    projectId?: string;
    sessionKey?: string;
    agentId?: string;
    monitoringMode?: MonitoringMode;
  }): WorkIntakeProposal {
    this._pruneExpired();
    const objective = input.objective.trim();
    if (!objective) throw new Error('Objective is required');
    const explicitProject = input.projectId ? this.projects.get(input.projectId) : undefined;
    if (input.projectId && !explicitProject) throw new Error('Project not found');
    const matches = this.projects.list({ status: 'active', limit: 200 }).items
      .map((project) => ({ project, score: projectScore(project, objective) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
    const matchedProject = explicitProject ?? (matches[0]?.score >= 4 ? matches[0].project : undefined);
    const id = randomUUID();
    const proposal: StoredProposal = {
      id,
      objective,
      classification: matchedProject ? 'existing_project' : 'new_project',
      suggestedProject: {
        id: matchedProject?.id,
        name: matchedProject?.name ?? compactTitle(objective),
        outcome: objective,
        nextAction: DEFAULT_NEXT_ACTION,
      },
      possibleProjectMatches: matches.map(({ project, score }) => ({ id: project.id, name: project.name, score })),
      monitoringSuggestion: {
        mode: input.monitoringMode ?? 'ask_before_action',
        scenarios: ['project_delivery_risk', 'blocked_work'],
      },
      expiresAt: Date.now() + INTAKE_TTL_MS,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
    };
    this.#proposals.set(id, proposal);
    const { sessionKey: _sessionKey, agentId: _agentId, ...publicProposal } = proposal;
    return publicProposal;
  }

  confirm(input: {
    proposalId: string;
    projectId?: string;
    projectName?: string;
    nextAction?: string;
  }): ConfirmedWork | undefined {
    this._pruneExpired();
    const proposal = this.#proposals.get(input.proposalId);
    if (!proposal) return undefined;
    const result = runSqliteWriteTransaction(() => {
      const selectedProjectId = input.projectId ?? proposal.suggestedProject.id;
      const existingProject = selectedProjectId ? this.projects.get(selectedProjectId) : undefined;
      if (selectedProjectId && !existingProject) throw new Error('Project not found');
      const project = existingProject ?? this.projects.create({
        name: input.projectName?.trim() || proposal.suggestedProject.name,
        description: proposal.objective,
        brief: proposal.objective,
        defaultAgentId: proposal.agentId,
      });
      const nextAction = input.nextAction?.trim() || proposal.suggestedProject.nextAction;
      const goal = this.#goals.create({
        title: proposal.suggestedProject.outcome,
        description: proposal.objective,
        projectId: project.id,
        sessionKey: proposal.sessionKey,
        agentId: proposal.agentId ?? project.defaultAgentId ?? 'main',
        source: 'api',
      });
      this.#goals.update(goal.id, { nextAction });
      const workItem = this.workItems.createProjectWorkItem(project.id, {
        title: proposal.suggestedProject.outcome,
        description: proposal.objective,
        status: 'todo',
        priority: 'normal',
        ownerAgentId: proposal.agentId ?? project.defaultAgentId,
        nextAction,
      });
      if (proposal.sessionKey && getSessionMetadata(proposal.sessionKey)) {
        this.projects.attachSession(proposal.sessionKey, project.id);
      }
      this.#monitoring.configure({
        projectId: project.id,
        mode: proposal.monitoringSuggestion.mode,
        scenarios: proposal.monitoringSuggestion.scenarios,
      });
      return {
        projectId: project.id,
        goalId: goal.id,
        workItemId: workItem.id,
        sessionKey: proposal.sessionKey,
      };
    });
    this.#proposals.delete(proposal.id);
    return result;
  }

  private _pruneExpired(now = Date.now()): void {
    for (const [id, proposal] of this.#proposals) {
      if (proposal.expiresAt <= now) this.#proposals.delete(id);
    }
  }
}
