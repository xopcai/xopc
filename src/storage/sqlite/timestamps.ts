export function timestampToMs(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return timestamp;
}

export function optionalTimestampToMs(value: string | undefined): number | null {
  return value === undefined ? null : timestampToMs(value);
}

export function timestampToIso(value: number): string {
  return new Date(value).toISOString();
}

export function optionalTimestampToIso(value: number | null): string | undefined {
  return value === null ? undefined : timestampToIso(value);
}
