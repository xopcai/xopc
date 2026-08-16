export interface DiscussionProjectCandidate {
  id: string;
  name: string;
}

export function findExactProjectMention(
  transcript: string,
  projects: DiscussionProjectCandidate[],
): DiscussionProjectCandidate | undefined {
  const normalizedTranscript = normalize(transcript);
  const matches = projects.filter((project) => normalizedTranscript.includes(normalize(project.name)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function acceptRankedProject(input: {
  projectCandidateId?: string;
  projectConfidence?: number;
  projectAlternativeConfidence?: number;
}, projects: DiscussionProjectCandidate[]): { id: string; score: number } | undefined {
  const score = input.projectConfidence ?? 0;
  if (
    !input.projectCandidateId
    || !projects.some((project) => project.id === input.projectCandidateId)
    || score < 0.85
    || score - (input.projectAlternativeConfidence ?? 0) < 0.15
  ) return undefined;
  return { id: input.projectCandidateId, score };
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}
