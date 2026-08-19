import { ObjectLinkService } from '../activity/service.js';
import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import type { ProjectService } from '../projects/project-service.js';

import { analyzeDiscussion } from './analyzer.js';
import { acceptRankedProject, findExactProjectMention } from './project-inference.js';
import {
  completeDiscussionOrganization,
  createDiscussionOrganization,
  updateDiscussionCapture,
} from './repository.js';
import type { DiscussionCapture, DiscussionOrganization } from './types.js';

const PROMPT_VERSION = 'discussion-organizer-v1';

export interface DiscussionOrganizerDeps {
  notes: NotesService;
  projects: ProjectService;
  getConfig: () => Config;
  organizeTranscript?: (
    transcript: string,
    capture: DiscussionCapture,
    signal?: AbortSignal,
  ) => Promise<{ organization: DiscussionOrganization; modelRef: string }>;
  onUpdated?: (capture: DiscussionCapture) => void;
  onCompleted?: (capture: DiscussionCapture, organization: DiscussionOrganization) => void;
}

export class DiscussionOrganizer {
  private readonly objectLinks = new ObjectLinkService();

  constructor(private readonly deps: DiscussionOrganizerDeps) {}

  async process(capture: DiscussionCapture, _owner: string, signal?: AbortSignal): Promise<DiscussionCapture> {
    const transcript = capture.canonicalTranscript?.trim();
    const inputHash = capture.canonicalTranscriptSha256;
    if (!transcript || !inputHash) throw new Error('Canonical discussion transcript is missing');

    const projects = this.deps.projects.list({ status: 'active', limit: 100 }).items;
    const result = this.deps.organizeTranscript
      ? await this.deps.organizeTranscript(transcript, capture, signal)
      : await analyzeDiscussion({
        config: this.deps.getConfig(),
        transcript,
        projects: projects.map(({ id, name }) => ({ id, name })),
        signal,
      });

    const record = createDiscussionOrganization({
      discussionId: capture.id,
      inputTranscriptSha256: inputHash,
      promptVersion: PROMPT_VERSION,
      modelRef: result.modelRef,
    });
    completeDiscussionOrganization(record.id, result.organization);

    let inferredProject: { id: string; score: number; source: 'exact_name' | 'model' } | undefined;
    if (!capture.projectId) {
      const exact = findExactProjectMention(transcript, projects);
      const ranked = acceptRankedProject(result.organization, projects);
      if (exact) inferredProject = { id: exact.id, score: 1, source: 'exact_name' };
      else if (ranked) inferredProject = { ...ranked, source: 'model' };
    }

    const note = await this.deps.notes.getNote(capture.noteId);
    if (!note) throw new Error('Discussion note is missing');
    const title = result.organization.title.trim().slice(0, 200);
    if (note.title?.startsWith('Discussion ·') && title) {
      await this.deps.notes.updateNote(capture.noteId, { title }, 'ai_edit');
    }

    const updated = updateDiscussionCapture(capture.id, {
      status: 'completed',
      generatedTitle: title,
      ...(inferredProject ? {
        projectId: inferredProject.id,
        projectInferenceScore: inferredProject.score,
        projectInferenceSource: inferredProject.source,
      } : {}),
      failureStage: undefined,
      failureCode: undefined,
      failureMessage: undefined,
      completedAt: Date.now(),
    }, ['organizing']);
    if (!updated) throw new Error('Discussion changed while applying organization');
    if (inferredProject) this.linkProject(updated, inferredProject.id);
    this.deps.onUpdated?.(updated);
    this.deps.onCompleted?.(updated, result.organization);
    return updated;
  }

  private linkProject(capture: DiscussionCapture, projectId: string): void {
    const project = this.deps.projects.get(projectId);
    if (!project) return;
    this.objectLinks.create({
      id: `discussion:${capture.id}:project`,
      from: { kind: 'note', id: capture.noteId },
      to: { kind: 'project', id: project.id, title: project.name },
      relation: 'belongs_to',
      source: 'agent',
    });
  }
}
