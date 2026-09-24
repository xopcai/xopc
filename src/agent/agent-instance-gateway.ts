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

import type { Agent, AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AgentTurnPolicy } from './orchestration/agent-turn-policy.js';

export interface AgentInstanceGateway {
  // ── Per-session resolved state ─────────────────────────────────────────
  /**
   * Effective markdown workspace root for `conversationId`, honouring any
   * `workingDirectoryOverride` previously set via `setSessionWorkspaceOverride`.
   */
  getResolvedWorkspaceForSession(conversationId: string): string;

  /**
   * Apply (or clear) the per-session workspace override. Passing `null`
   * removes the override so the session falls back to the agent default.
   */
  setSessionWorkspaceOverride(conversationId: string, absolutePath: string | null): void;

  // ── Per-session runtime mutators ───────────────────────────────────────
  setThinkingLevel(conversationId: string, level: ThinkingLevel): void;
  setModelForSession(conversationId: string, modelId: string): boolean;

  // ── Agent instance lifecycle ───────────────────────────────────────────
  getOrCreateAgent(conversationId: string): Agent;
  getAgent(conversationId: string): Agent | undefined;
  /** Returns true when an agent instance existed for `conversationId` and was removed. */
  removeAgent(conversationId: string): boolean;
  /** Finish loading and initialize memory providers before agent construction or recall. */
  ensureMemoryReadyForSession?(conversationId: string): Promise<void>;

  /** Create isolated policy state for one user-visible agent run. */
  createAgentTurnPolicy(conversationId: string): AgentTurnPolicy;
  /** Publish events from the actual embedded runtime to session observers. */
  emitRuntimeEvent(conversationId: string, event: AgentEvent): void;

  // ── Read-through accessors ─────────────────────────────────────────────
  /** Last assistant text from the in-memory agent (empty when no agent / no assistant yet). */
  getLastAssistantContent(conversationId: string): string | null;

  // ── Turn-time hooks (called by direct-turn helpers + orchestrator) ────
  /** Build the bounded, policy-filtered context used for this model turn. */
  prepareUserTurnContext(
    userMessage: AgentMessage,
    conversationId: string,
    turnId: string,
  ): Promise<import('./context/coordinator.js').ExecutionContextPlan>;

  /** Fire-and-forget maintenance of durable user understanding after a completed turn. */
  scheduleUserUnderstandingMaintenance(conversationId: string, userPlainText: string, turnId: string): void;

  /** Bump the per-session "turns since memory review" counter. */
  beginBackgroundReviewUserTurn(conversationId: string): void;

  /** Fire-and-forget review (memory + skill nudges) once the main turn finishes. */
  scheduleBackgroundReviewAfterUserTurn(conversationId: string): void;

  // ── Skill prompt expansion (`/skill:name` shorthand) ──────────────────
  expandSkillUserText(text: string): string;
  prepareSkillTurn(conversationId: string, text: string): { text: string; activatedCapabilityNames: string[] };
  withSkillCapabilities<T>(
    conversationId: string,
    capabilityNames: readonly string[],
    run: () => Promise<T>,
  ): Promise<T>;
}
