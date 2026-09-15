import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { ObjectLinkService } from '../activity/service.js';
import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import type { ProjectService } from '../projects/project-service.js';

import { applyMeetingEdits } from './edits.js';
import { saveTranscriptRevision } from './revisions.js';
import { getDiscussionCapture, listDiscussionTranscriptSegments, getLatestDiscussionOrganization, renewDiscussionWorkLease } from './repository.js';
import { analyzeDiscussion } from './analyzer.js';
import { acceptRankedProject, findExactProjectMention } from './project-inference.js';
import {
  completeDiscussionOrganization,
  createDiscussionOrganization,
  updateDiscussionCapture,
} from './repository.js';
import type { DiscussionCapture, DiscussionOrganization } from './types.js';

const PROMPT_VERSION = 'discussion-evidence-v2';

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

  async process(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture> {
    const transcript = capture.canonicalTranscript?.trim();
    const inputHash = capture.canonicalTranscriptSha256;
    if (!transcript || !inputHash) throw new Error('Canonical discussion transcript is missing');

    const transcriptRevision = saveTranscriptRevision(capture.id);
    const projects = this.deps.projects.list({ status: 'active', limit: 100 }).items;
    const result = this.deps.organizeTranscript
      ? await this.deps.organizeTranscript(transcript, capture, signal)
      : await analyzeDiscussion({
        config: this.deps.getConfig(),
        transcript,
        segments: listDiscussionTranscriptSegments(capture.id),
        discussionId: capture.id,
        template: capture.template,
        projects: projects.map(({ id, name }) => ({ id, name })),
        signal,
      });

    signal?.throwIfAborted();
    if (!renewDiscussionWorkLease(capture.id, owner)) throw new Error('Meeting processing lease lost');
    if (getDiscussionCapture(capture.id)?.canonicalTranscriptSha256 !== inputHash) throw new Error('Transcript changed during organization');
    const previous = getLatestDiscussionOrganization(capture.id)?.organization;
    if (previous) {
      const signature = (refs: number[]) => JSON.stringify([...refs].sort((a, b) => a - b));
      for (const kind of ['decisions', 'actionItems', 'risks', 'openQuestions'] as const) {
        for (const item of result.organization[kind]) {
          const candidates = previous[kind].filter(old => signature(old.evidenceSegmentIds) === signature(item.evidenceSegmentIds));
          const label = (value: typeof item) => 'title' in value ? value.title : value.text;
          const exact = previous[kind].filter(old => label(old) === label(item));
          const matches = exact.length ? exact : candidates;
          const currentMatches = result.organization[kind].filter(other => signature(other.evidenceSegmentIds) === signature(item.evidenceSegmentIds));
          if (matches.length === 1 && ((label(matches[0]!) === label(item) && result.organization[kind].filter(other => label(other) === label(item)).length === 1) || currentMatches.length === 1)) item.id = matches[0]!.id;
        }
      }
    }

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

    const updated = runSqliteWriteTransaction(() => {
      signal?.throwIfAborted();
      if (!renewDiscussionWorkLease(capture.id, owner)) throw new Error('Meeting processing lease lost');
      if (getDiscussionCapture(capture.id)?.canonicalTranscriptSha256 !== inputHash) throw new Error('Transcript changed during organization');
    const record = createDiscussionOrganization({
      discussionId: capture.id,
      transcriptRevision,
      inputTranscriptSha256: inputHash,
      promptVersion: PROMPT_VERSION,
      modelRef: result.modelRef,
    });
    result.organization = applyMeetingEdits(capture.id, result.organization);
    completeDiscussionOrganization(record.id, result.organization);

    const published = updateDiscussionCapture(capture.id, {
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
      completedAt: capture.completedAt ?? Date.now(),
    }, ['organizing']);
    if (!published) throw new Error('Discussion changed while applying organization');
    return published;
    });
    if (inferredProject) this.linkProject(updated, inferredProject.id);
    this.deps.onUpdated?.(updated);
    if (!capture.completedAt) this.deps.onCompleted?.(updated, result.organization);
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
