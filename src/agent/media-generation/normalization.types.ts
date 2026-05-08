/**
 * Shared normalization types for media generation capabilities
 * (image / audio / video). Carry the "what user asked" vs "what we
 * actually sent" reconciliation across providers.
 */

export type MediaNormalizationValue = string | number;

export type MediaNormalizationDerivationSource = 'size' | 'aspectRatio' | 'resolution';

export interface MediaNormalizationEntry<TValue extends MediaNormalizationValue> {
  /** Original value supplied by caller (before normalization). */
  requested?: TValue;
  /** Value actually delivered to the provider. */
  applied?: TValue;
  /** When `applied` was derived from a different field, name that source field. */
  derivedFrom?: MediaNormalizationDerivationSource;
  /** Provider-supported values; useful for surfacing hints in UI / tool output. */
  supportedValues?: TValue[];
}

export function hasMediaNormalizationEntry<T extends MediaNormalizationValue>(
  entry: MediaNormalizationEntry<T> | undefined,
): entry is MediaNormalizationEntry<T> {
  if (!entry) return false;
  return entry.requested !== undefined || entry.applied !== undefined || entry.derivedFrom !== undefined;
}
