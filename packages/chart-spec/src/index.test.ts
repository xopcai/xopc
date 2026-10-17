import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CHART_LIMITS, ChartSpecError, parseChartSpec } from './index';

const example = (type: 'line' | 'bar' = 'line') => readFileSync(new URL(`../../../skills/creative/chat-charts/references/${type}-example.json`, import.meta.url), 'utf8');
const input = () => JSON.parse(example());

describe('ChartSpec v1', () => {
  it.each(['line', 'bar'] as const)('accepts the %s skill example without modifying data', type => {
    expect(parseChartSpec(example(type))).toEqual(JSON.parse(example(type)));
  });

  it('preserves gaps, negative values, zero and source order', () => {
    const spec = input();
    spec.series[0].values = [null, -1.5, 0];
    expect(parseChartSpec(JSON.stringify(spec)).series[0].values).toEqual([null, -1.5, 0]);
  });

  it.each([
    ['version', 2, 'UNSUPPORTED_VERSION'],
    ['type', 'pie', 'UNSUPPORTED_TYPE'],
    ['title', '', 'INVALID_TEXT'],
    ['summary', ' '.repeat(10), 'INVALID_TEXT'],
    ['dataKind', 'verified', 'INVALID_DATA_KIND'],
    ['series', [], 'INVALID_ARRAY'],
    ['option', {}, 'UNKNOWN_FIELD'],
    ['formatter', '() => alert(1)', 'UNKNOWN_FIELD'],
  ])('rejects invalid %s', (field, value, code) => {
    expect(() => parseChartSpec(JSON.stringify({ ...input(), [field]: value }))).toThrow(code);
  });

  it('requires attribution for real datasets', () => {
    const spec = { ...input(), dataKind: 'real' };
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('SOURCES_REQUIRED');
    const withSources = { ...spec, sources: ['User-provided ledger, January–March 2026, CNY'] };
    expect(parseChartSpec(JSON.stringify(withSources))).toEqual(withSources);
  });

  it('rejects mismatched lengths and duplicate series names', () => {
    const spec = input();
    spec.series[0].values.pop();
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('LENGTH_MISMATCH');
    spec.series[0] = spec.series[1];
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('DUPLICATE_SERIES');
  });

  it.each(['12', {}, [], true])('rejects nonnumeric points: %j', point => {
    const spec = input();
    spec.series[0].values[0] = point;
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('INVALID_NUMBER');
  });

  it('rejects nonfinite numbers and all-null data', () => {
    expect(() => parseChartSpec(example().replace('12000', '1e999'))).toThrow('INVALID_NUMBER');
    const spec = input();
    spec.series.forEach((series: { values: null[] }) => { series.values = [null, null, null]; });
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('EMPTY_DATA');
  });

  it('rejects unsafe nested fields and prototype keys', () => {
    const spec = input();
    spec.series[0].itemStyle = { color: 'image://https://example.com/tracker.png' };
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('UNKNOWN_FIELD');
    expect(() => parseChartSpec(example().replace('"version": 1', '"__proto__": {}, "version": 1'))).toThrow('UNKNOWN_FIELD');
    expect({}).not.toHaveProperty('polluted');
  });

  it('bounds bytes, series count and total points', () => {
    expect(() => parseChartSpec(' '.repeat(CHART_LIMITS.bytes + 1))).toThrow('TOO_LARGE');
    expect(() => parseChartSpec('汉'.repeat(CHART_LIMITS.bytes / 2))).toThrow('TOO_LARGE');
    const spec = input();
    spec.series = Array.from({ length: 21 }, (_, i) => ({ name: String(i), values: [1, 2, 3] }));
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('INVALID_ARRAY');
    spec.xAxis.values = Array.from({ length: 501 }, (_, i) => String(i));
    spec.series = Array.from({ length: 20 }, (_, i) => ({ name: String(i), values: Array(501).fill(1) }));
    expect(() => parseChartSpec(JSON.stringify(spec))).toThrow('TOO_MANY_POINTS');
  });

  it.each(['{title: "bad"}', '{"version":1,}', 'null', '[]'])('reports structured errors for %s', source => {
    expect(() => parseChartSpec(source)).toThrow(ChartSpecError);
  });
});
