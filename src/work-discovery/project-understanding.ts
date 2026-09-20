import { listKnowledgeItems, writeKnowledgeItem } from '../knowledge-memory/index.js';

export function getProjectUnderstandingOverview(projectId: string) {
  return listKnowledgeItems({ scope: { type: 'project', id: projectId }, statuses: ['active'],
    canonicalKey: `project-understanding:${projectId}`, limit: 1 })[0];
}

export function saveProjectUnderstandingOverview(input: {
  projectId: string;
  content: string;
  correctedByUser?: boolean;
  evidenceRefs?: string[];
}) {
  const existing = getProjectUnderstandingOverview(input.projectId);
  // A refresh must not overwrite the user's corrections.
  if (!input.correctedByUser && existing?.originClass === 'owner') return existing;
  return writeKnowledgeItem({
    kind: 'project_fact', scope: { type: 'project', id: input.projectId },
    canonicalKey: `project-understanding:${input.projectId}`,
    content: input.content.slice(0, 6_000), status: 'active', importance: 0.9,
    confidence: input.correctedByUser ? 1 : 0.7,
    originClass: input.correctedByUser ? 'owner' : 'agent',
    source: { provider: 'project-understanding', evidenceRefs: input.evidenceRefs ?? [] },
    replaceExisting: true,
    restoreDeleted: input.correctedByUser,
  }).item;
}
