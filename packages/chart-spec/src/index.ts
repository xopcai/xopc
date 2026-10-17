export interface ChartSpec {
  version: 1;
  type: 'line' | 'bar';
  title: string;
  summary: string;
  dataKind: 'real' | 'example';
  sources?: string[];
  xAxis: { label: string; values: string[] };
  yAxis: { label: string; unit: string };
  series: { name: string; values: (number | null)[] }[];
}

export const CHART_LIMITS = {
  bytes: 100 * 1024,
  series: 20,
  points: 10_000,
  text: 200,
  summary: 2000,
} as const;

export class ChartSpecError extends Error {
  constructor(public readonly path: string, public readonly code: string) {
    super(`${path}: ${code}`);
    this.name = 'ChartSpecError';
  }
}

function fail(path: string, code: string): never {
  throw new ChartSpecError(path, code);
}

function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'OBJECT_REQUIRED');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'UNKNOWN_FIELD');
  }
  return record;
}

function text(value: unknown, path: string, max: number = CHART_LIMITS.text): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(path, 'INVALID_TEXT');
  return value;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) fail(path, 'INVALID_ARRAY');
  return value;
}

/** Parse untrusted Markdown data into a fresh, bounded v1 spec. Never pass raw options to a renderer. */
export function parseChartSpec(source: string): ChartSpec {
  if (source.length > CHART_LIMITS.bytes || new TextEncoder().encode(source).byteLength > CHART_LIMITS.bytes) {
    fail('$', 'TOO_LARGE');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { fail('$', 'INVALID_JSON'); }
  const root = object(parsed, ['version', 'type', 'title', 'summary', 'dataKind', 'sources', 'xAxis', 'yAxis', 'series'], '$');
  if (root.version !== 1) fail('$.version', 'UNSUPPORTED_VERSION');
  if (root.type !== 'line' && root.type !== 'bar') fail('$.type', 'UNSUPPORTED_TYPE');
  if (root.dataKind !== 'real' && root.dataKind !== 'example') fail('$.dataKind', 'INVALID_DATA_KIND');
  const x = object(root.xAxis, ['label', 'values'], '$.xAxis');
  const y = object(root.yAxis, ['label', 'unit'], '$.yAxis');
  const labels = array(x.values, '$.xAxis.values', CHART_LIMITS.points)
    .map((value, i) => text(value, `$.xAxis.values[${i}]`));
  const names = new Set<string>();
  const series = array(root.series, '$.series', CHART_LIMITS.series).map((value, i) => {
    const path = `$.series[${i}]`;
    const entry = object(value, ['name', 'values'], path);
    const name = text(entry.name, `${path}.name`);
    if (names.has(name)) fail(`${path}.name`, 'DUPLICATE_SERIES');
    names.add(name);
    const points = array(entry.values, `${path}.values`, CHART_LIMITS.points);
    if (points.length !== labels.length) fail(`${path}.values`, 'LENGTH_MISMATCH');
    const values = points.map((point, j): number | null => {
      if (point === null) return null;
      if (typeof point !== 'number' || !Number.isFinite(point)) fail(`${path}.values[${j}]`, 'INVALID_NUMBER');
      return point;
    });
    return { name, values };
  });
  if (series.length * labels.length > CHART_LIMITS.points) fail('$.series', 'TOO_MANY_POINTS');
  if (!series.some(entry => entry.values.some(value => value !== null))) fail('$.series', 'EMPTY_DATA');
  const sources = root.sources === undefined ? undefined
    : array(root.sources, '$.sources', 20).map((value, i) => text(value, `$.sources[${i}]`, 2000));
  if (root.dataKind === 'real' && !sources) fail('$.sources', 'SOURCES_REQUIRED');
  return {
    version: 1,
    type: root.type,
    title: text(root.title, '$.title'),
    summary: text(root.summary, '$.summary', CHART_LIMITS.summary),
    dataKind: root.dataKind,
    ...(sources ? { sources } : {}),
    xAxis: { label: text(x.label, '$.xAxis.label'), values: labels },
    yAxis: { label: text(y.label, '$.yAxis.label'), unit: text(y.unit, '$.yAxis.unit') },
    series,
  };
}
