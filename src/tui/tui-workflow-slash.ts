/**
 * Helper for {@link createTuiCommandHandler}: when the user types an unknown
 * slash command in the TUI, check whether the name matches a saved workflow
 * and, if so, rewrite the input into a natural-language prompt that
 * deterministically triggers the `workflow` tool.
 *
 * Why a rewrite and not a direct execution?
 *   Slash commands in xopc are handled by the chat-commands framework whose
 *   handlers return text shown back to the user — there is no hook to "inject
 *   the result as the next user message and start an agent turn". So the
 *   shortest reliable path is to turn `/audit_repo` into the same plain-text
 *   request the model already knows how to handle.
 *
 * Why catalog the workflow list at the TUI layer?
 *   The catalog reads `~/.xopc/workflows/` synchronously (single `readdir`),
 *   so the slash dispatch stays sync and the user sees no latency. The lookup
 *   only runs for inputs that started with `/` and didn't match any built-in
 *   or extension command, so the cost is negligible.
 *
 * Built-in TUI command names that overlap with a workflow file name keep their
 * existing TUI behaviour — the slash dispatcher matches the built-in switch
 * cases before this helper is consulted.
 */

import { createWorkflowCatalog } from '../agent/workflow/catalog.js';

let cachedNames: Set<string> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5_000;

/** Reset the cache (for tests, or after a `/workflow save`). */
export function resetWorkflowSlashCache(): void {
  cachedNames = null;
  cachedAt = 0;
}

function knownWorkflowNames(): Set<string> {
  const now = Date.now();
  if (cachedNames && now - cachedAt < CACHE_TTL_MS) return cachedNames;
  try {
    const catalog = createWorkflowCatalog();
    cachedNames = new Set(catalog.list().map((e) => e.name));
  } catch {
    cachedNames = new Set();
  }
  cachedAt = now;
  return cachedNames;
}

/**
 * Returns a rewritten user message when `name` matches a known workflow,
 * otherwise `null`. Args after the slash are passed along as a hint to the
 * model — most workflows expect free-form context, not strict JSON, and the
 * model can shape the call.
 */
export function rewriteUnknownSlashAsWorkflow(
  name: string,
  args: string,
  resolver: () => Set<string> = knownWorkflowNames,
): string | null {
  const normalized = name.trim();
  if (!normalized) return null;
  if (!resolver().has(normalized)) return null;

  const tail = args.trim();
  if (!tail) {
    return `Run the ${normalized} workflow (call workflow tool with name="${normalized}").`;
  }
  return (
    `Run the ${normalized} workflow (call workflow tool with name="${normalized}").\n` +
    `Use this argument: ${tail}`
  );
}
