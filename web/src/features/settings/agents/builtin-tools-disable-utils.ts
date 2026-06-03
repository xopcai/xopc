/** Preset ids are filtered against the live built-in list from the gateway. */
export function sortedDisableList(ids: Set<string>): string[] {
  return Array.from(ids).flatMap((s) => {
    const v = s.trim();
    return v ? [v] : [];
  }).toSorted((x, y) => x.localeCompare(y));
}
