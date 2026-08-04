export type ElectronHistorySnapshot = {
  entries: string[];
  index: number;
};

export type ElectronHistoryAction = 'POP' | 'PUSH' | 'REPLACE';

export function advanceElectronHistory(
  snapshot: ElectronHistorySnapshot | undefined,
  locationKey: string,
  action: ElectronHistoryAction,
): ElectronHistorySnapshot {
  if (!snapshot) return { entries: [locationKey], index: 0 };
  if (snapshot.entries[snapshot.index] === locationKey) return snapshot;

  if (action === 'PUSH') {
    const entries = [...snapshot.entries.slice(0, snapshot.index + 1), locationKey];
    return { entries, index: entries.length - 1 };
  }

  if (action === 'REPLACE') {
    const entries = [...snapshot.entries];
    entries[snapshot.index] = locationKey;
    return { entries, index: snapshot.index };
  }

  const index = snapshot.entries.indexOf(locationKey);
  return index >= 0 ? { entries: snapshot.entries, index } : { entries: [locationKey], index: 0 };
}
