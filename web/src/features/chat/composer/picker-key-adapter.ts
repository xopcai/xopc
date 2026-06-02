import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * A single picker's keyboard contract. Composer-level dispatch is just an in-order walk
 * over a list of these — first active adapter that consumes the event wins.
 *
 * `handleKey` MUST call `e.preventDefault()` itself when consuming. Returning `true`
 * tells the dispatcher to stop walking; nothing else happens to the event.
 */
export interface PickerKeyAdapter {
  /** Debug label; also used to keep React `key`s stable when adapters are rendered as a list. */
  name: string;
  /** Skipped when false (cheap pre-filter — `dispatchPickerKey` short-circuits without calling `handleKey`). */
  isActive: () => boolean;
  /** Returns `true` when the event is consumed; subsequent adapters are not called. */
  handleKey: (e: ReactKeyboardEvent) => boolean;
}

/**
 * Walk the adapters in priority order. First active adapter to return `true` consumes the key.
 * Returns `true` overall iff some adapter consumed.
 */
export function dispatchPickerKey(
  adapters: readonly PickerKeyAdapter[],
  e: ReactKeyboardEvent,
): boolean {
  for (const adapter of adapters) {
    if (!adapter.isActive()) continue;
    if (adapter.handleKey(e)) return true;
  }
  return false;
}
