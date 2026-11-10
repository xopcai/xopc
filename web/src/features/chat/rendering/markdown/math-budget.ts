import { mathRanges } from '@xopcai/markdown-math/remark';

/** Reuse counts for completed blocks instead of rescanning all source on each delta. */
export function createMathBudget(count = (source: string) => mathRanges(source).length) {
  let previous: { source: string; count: number }[] = [];
  let previousBudget: number[] = [];
  return (blocks: string[]): number[] => {
    let used = 0;
    const next: typeof previous = [];
    const remaining = blocks.map((source, index) => {
      const budget = Math.max(0, 256 - used);
      const cached = previous[index];
      const entry = cached?.source === source ? cached : { source, count: count(source) };
      next.push(entry);
      used += entry.count;
      return budget;
    });
    previous = next;
    // Context consumers must not rerender completed blocks when only the tail text changes.
    if (remaining.length === previousBudget.length && remaining.every((value, index) => value === previousBudget[index])) {
      return previousBudget;
    }
    previousBudget = remaining;
    return remaining;
  };
}
