import { describe, expect, it } from 'vitest';

import {
  buildImageProvidersConfigPatch,
  emptyImageProviderCredRow,
  imageProviderCredRowsFromConfigRoot,
} from '../image-providers-config-api';

describe('imageProviderCredRowsFromConfigRoot', () => {
  it('maps masked apiKey and optional fields', () => {
    const rows = imageProviderCredRowsFromConfigRoot(
      {
        providersConfig: {
          dashscope: { apiKey: '***', region: 'beijing' },
        },
      },
      ['dashscope', 'fal'],
    );
    expect(rows.dashscope?.apiKey).toBe('••••••••••••');
    expect(rows.dashscope?.region).toBe('beijing');
    expect(rows.fal?.apiKey).toBe('');
  });
});

describe('buildImageProvidersConfigPatch', () => {
  it('returns empty when unchanged', () => {
    const row = { ...emptyImageProviderCredRow(), region: 'sg' };
    expect(buildImageProvidersConfigPatch(['x'], { x: row }, { x: row })).toEqual({});
  });

  it('patches new api key', () => {
    const b = emptyImageProviderCredRow();
    const d = { ...b, apiKey: 'sk-test' };
    expect(buildImageProvidersConfigPatch(['p'], { p: d }, { p: b })).toEqual({
      p: { apiKey: 'sk-test' },
    });
  });

  it('clears api key with null', () => {
    const b = { ...emptyImageProviderCredRow(), apiKey: '••••••••••••' };
    const d = emptyImageProviderCredRow();
    expect(buildImageProvidersConfigPatch(['p'], { p: d }, { p: b })).toEqual({
      p: { apiKey: null },
    });
  });

  it('patches region without apiKey when key unchanged', () => {
    const b = { ...emptyImageProviderCredRow(), apiKey: '••••••••••••', region: 'beijing' };
    const d = { ...emptyImageProviderCredRow(), apiKey: '••••••••••••', region: 'singapore' };
    expect(buildImageProvidersConfigPatch(['p'], { p: d }, { p: b })).toEqual({
      p: { region: 'singapore' },
    });
  });
});
