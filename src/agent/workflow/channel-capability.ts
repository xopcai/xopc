/**
 * Channel-side contract used by {@link WorkflowProgressBroker} to deliver
 * workflow progress to a specific messaging surface (Telegram, Feishu, …).
 *
 * Why a capability instead of a hook on `ChannelPlugin`?
 *   - Optional opt-in: channels register themselves at boot; no plugin
 *     changes for surfaces that don't ship progress (e.g. SMS).
 *   - Per-channel sane defaults baked in (throttle, mode) — the broker
 *     reads these and lets `channels.<id>.workflowProgress` in config
 *     override per deployment.
 *   - Decouples the broker from the {@link ChannelPlugin} interface so
 *     adding new channels never grows broker imports.
 */

export type WorkflowProgressMode =
  /** Edit a single message in place (Telegram, Feishu). */
  | 'edit'
  /** Append a new message on each key event (WeChat — can't edit). */
  | 'append'
  /** No mid-run updates; final-only message at completion. */
  | 'final-only';

export interface WorkflowProgressPostInput {
  /** Routing key for the run — channel uses it to resolve the destination chat. */
  sessionKey: string;
  /** Pre-rendered progress text (already includes header / phases / logs). */
  text: string;
  /**
   * Message id returned by the previous `postProgress` for the same run, when
   * editing in place. `undefined` for the first message of a run, or always
   * for `append` / `final-only` modes.
   */
  previousMessageId?: string;
  /**
   * `true` for the final completion message (sent right after `tool_end`).
   * Useful for channels that want to bypass their own rate limiting for the
   * last update (so users always see the conclusion).
   */
  isFinal: boolean;
  /**
   * The effective rendering mode for this dispatch — broker resolves it from
   * the capability's `defaultMode` plus any `channels.<id>.workflowProgress.mode`
   * override. Capabilities can use this to adjust message shape (e.g. WeChat
   * prefixes mid-run `append` messages with "▾ progress" so the user can tell
   * them apart from the final summary).
   *
   * Optional only to keep hand-rolled callers and unit-test stubs lean — the
   * broker always provides it. Capabilities that consume the field should
   * default to `'edit'` when missing.
   */
  mode?: WorkflowProgressMode;
}

export interface WorkflowProgressPostResult {
  /** New / unchanged message id to use as `previousMessageId` next time. */
  messageId: string;
}

export interface ChannelProgressCapability {
  /** Stable channel id matching `channels.<id>` in config (e.g. `telegram`). */
  readonly channelId: string;
  /** True when the underlying platform exposes editMessage semantics. */
  readonly supportsEdit: boolean;
  /** Sane default throttle (ms) for this surface; respects platform limits. */
  readonly defaultThrottleMs: number;
  /** Sane default mode for this surface. */
  readonly defaultMode: WorkflowProgressMode;
  /**
   * Deliver one progress update.
   *
   * Capability is responsible for:
   * - Resolving `sessionKey` → platform chat/thread id (channel-specific).
   * - Encoding the text payload (markdown / plain / HTML, line breaks).
   * - Calling editMessageText vs sendMessage based on `previousMessageId`.
   * - Honouring platform rate limits (429 retry-after, etc.).
   *
   * Throw on hard failure; the broker logs and drops the update.
   */
  postProgress(input: WorkflowProgressPostInput): Promise<WorkflowProgressPostResult>;
}
