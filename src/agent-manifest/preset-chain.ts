export type PresetWithParents = {
  extends?: readonly string[];
};

/**
 * Linearize preset inheritance once, in parent-before-child order.
 *
 * A shared parent is emitted only on its first visit. This gives diamond
 * inheritance one deterministic meaning across every runtime consumer.
 */
export function linearizePresetIds<T extends PresetWithParents>(
  rootIds: readonly string[],
  presets: Readonly<Record<string, T>>,
): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const out: string[] = [];

  const visit = (id: string, stack: readonly string[]): void => {
    if (visiting.has(id)) {
      throw new Error(`Capability preset cycle detected: ${[...stack, id].join(' -> ')}`);
    }
    if (visited.has(id)) return;
    const preset = presets[id];
    if (!preset) {
      throw new Error(`Capability preset "${id}" was not found`);
    }
    visiting.add(id);
    for (const parent of preset.extends ?? []) {
      visit(parent, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
    out.push(id);
  };

  for (const id of rootIds) visit(id, []);
  return out;
}
