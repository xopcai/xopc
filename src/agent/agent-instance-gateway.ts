/**
 * AgentInstanceGateway — narrow public face of AgentManager that lower-level
 * subsystems are allowed to depend on.
 *
 * The full `AgentManager` class is owned by `AgentService` and orchestrates
 * per-session `pi-agent-core` instances, the tools factory, the workspace
 * runtime cache, memory + background-review coordinators, etc. Embedded
 * runtime modules, the session subsystem, and the direct-turn helpers need
 * only a sliver of that surface (per-session reads + a few mutating side
 * effects); they should not see the rest.
 *
 * This interface captures exactly that sliver. Lower-level modules import the
 * interface; `AgentManager` `implements` it (structurally + nominally) so any
 * drift between the interface and the concrete class is a TypeScript error.
 *
 * The pattern mirrors `service.types.ts` vs `service.ts` — types live in a
 * leaf module, the heavy implementation file pulls them in. The
 * dependency-cruiser rule `no-<X>-to-agent-manager` enforces that lower-level
 * modules do NOT bypass this interface and depend on `agent-manager.ts`.
 */

import type { Agent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AgentTurnPolicy } from './orchestration/agent-turn-policy.js';

export interface AgentInstanceGateway {
  // ── Per-session resolved state ─────────────────────────────────────────
  /**
   * Effective markdown workspace root for `sessionKey`, honouring any
   * `workingDirectoryOverride` previously set via `setSessionWorkspaceOverride`.
   */
  getResolvedWorkspaceForSession(sessionKey: string): string;

  /**
   * Apply (or clear) the per-session workspace override. Passing `null`
   * removes the override so the session falls back to the agent default.
   */
  setSessionWorkspaceOverride(sessionKey: string, absolutePath: string | null): void;

  // ── Per-session runtime mutators ───────────────────────────────────────
  setThinkingLevel(sessionKey: string, level: ThinkingLevel): void;
  setModelForSession(sessionKey: string, modelId: string): boolean;

  // ── Agent instance lifecycle ───────────────────────────────────────────
  getOrCreateAgent(sessionKey: string): Agent;
  getAgent(sessionKey: string): Agent | undefined;
  /** Returns true when an agent instance existed for `sessionKey` and was removed. */
  removeAgent(sessionKey: string): boolean;

  /** Create isolated policy state for one user-visible agent run. */
  createAgentTurnPolicy(sessionKey: string): AgentTurnPolicy;

  // ── Read-through accessors ─────────────────────────────────────────────
  /** Last assistant text from the in-memory agent (empty when no agent / no assistant yet). */
  getLastAssistantContent(sessionKey: string): string | null;

  // ── Turn-time hooks (called by direct-turn helpers + orchestrator) ────
  /** Build the bounded, policy-filtered context used for this model turn. */
  prepareUserTurnContext(
    userMessage: AgentMessage,
    sessionKey: string,
    turnId: string,
  ): Promise<import('./memory/context/types.js').UserContextPlan>;

  /** Post-turn: sync external memory providers, queue next prefetch. */
  afterAgentTurn(sessionKey: string, userPlainText: string, turnId: string): Promise<import('./memory/understanding/types.js').UnderstandingReviewResult | undefined>;

  /** Bump the per-session "turns since memory review" counter. */
  beginBackgroundReviewUserTurn(sessionKey: string): void;

  /** Fire-and-forget review (memory + skill nudges) once the main turn finishes. */
  scheduleBackgroundReviewAfterUserTurn(sessionKey: string): void;

  // ── Skill prompt expansion (`/skill:name` shorthand) ──────────────────
  expandSkillUserText(text: string): string;
  prepareSkillTurn(sessionKey: string, text: string): { text: string; activatedCapabilityNames: string[] };
  withSkillCapabilities<T>(
    sessionKey: string,
    capabilityNames: readonly string[],
    run: () => Promise<T>,
  ): Promise<T>;
}
