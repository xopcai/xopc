import { describe, expect, it } from 'vitest';
import { hiddenResultCount, previewArtifacts, previewDeliveries } from '../entry/src/main/ets/common/chatResultPreview.ets';

const artifacts = Array.from({ length: 5 }, (_, index) => ({
  artifactId: `a-${index}`,
  title: `File ${index}`,
  kind: 'file',
  availability: 'available',
}));
const deliveries = Array.from({ length: 4 }, (_, index) => ({
  version: 1,
  operation: 'created',
  primary: { kind: 'note', id: `n-${index}`, title: `Note ${index}` },
}));

describe('assistant result preview', () => {
  it('limits the combined default preview to three rows', () => {
    expect(previewArtifacts(artifacts, false)).toHaveLength(3);
    expect(previewDeliveries(artifacts, deliveries, false)).toHaveLength(0);
    expect(hiddenResultCount(artifacts, deliveries)).toBe(6);
  });

  it('uses remaining preview slots for product deliveries', () => {
    expect(previewArtifacts(artifacts.slice(0, 1), false)).toHaveLength(1);
    expect(previewDeliveries(artifacts.slice(0, 1), deliveries, false)).toHaveLength(2);
  });

  it('returns every item only after explicit expansion', () => {
    expect(previewArtifacts(artifacts, true)).toHaveLength(5);
    expect(previewDeliveries(artifacts, deliveries, true)).toHaveLength(4);
  });
});
