import {
  HomeEvidencePresentationSchema,
  type HomeEvidence,
  type HomeEvidencePresentation,
} from '@xopcai/gateway-contract';

/** Validate display summaries without changing authoritative evidence or recommendation eligibility. */
export function buildEvidencePresentation(
  groups: unknown,
  candidateEvidenceIds: readonly string[],
  evidence: readonly HomeEvidence[],
  locale: 'zh' | 'en',
): HomeEvidencePresentation | undefined {
  const parsed = HomeEvidencePresentationSchema.safeParse({ version: 1, locale, groups });
  if (!parsed.success) return undefined;
  const allowed = new Set(evidence.map((item) => item.id));
  if (candidateEvidenceIds.some((id) => !allowed.has(id))) return undefined;
  const seen = new Set<string>();
  for (const group of parsed.data.groups) {
    if (/<\/?[a-z][^>]*>/i.test(group.summary)) return undefined;
    // Ignore identifiers, URLs, paths and filenames, but reject English prose
    // even when it contains a Chinese product name. This is a language heuristic,
    // not a factual or translation-quality guarantee.
    const prose = group.summary
      .replace(/`([^`]*)`/g, (_match, value: string) => /\b[a-z]+(?:[ \t]+[a-z]+){3,}\b/i.test(value) ? value : '')
      .replace(/https?:\/\/\S+|(?:\/[\w.~-]+){2,}|[\w\p{Script=Han}-]+\.[a-z0-9]{1,8}\b/giu, '')
      .replace(/\b[A-Z][A-Z0-9_-]+\b/g, '');
    if (locale === 'zh') {
      if ((/[a-z]/i.test(prose) && !/\p{Script=Han}/u.test(prose))
        || /\b[a-z]+(?:[ \t]+[a-z]+){3,}\b/i.test(prose)) return undefined;
    } else if (/\p{Script=Han}/u.test(prose) && !/[a-z]/i.test(prose)) return undefined;
    for (const id of group.evidenceIds) {
      if (!allowed.has(id) || seen.has(id)) return undefined;
      seen.add(id);
    }
  }
  return seen.size === allowed.size ? parsed.data : undefined;
}
