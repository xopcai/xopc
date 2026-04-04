import fs from "node:fs";
import path from "node:path";

import { logger } from "../util/logger.js";
import { generateId } from "../util/random.js";
import type { WeixinMessage, MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { canonicalWeixinPeerId, normalizeWeixinAccountId } from "../auth/weixin-account-id.js";
import { resolveWeixinRootDir } from "../storage/state-dir.js";

// ---------------------------------------------------------------------------
// Context token store (in-process cache + disk persistence)
// ---------------------------------------------------------------------------

type WeixinContextTokenEntry = { token: string; sendTo?: string };

/**
 * contextToken is issued per-message by the Weixin getupdates API and must
 * be echoed verbatim in every outbound send. The in-memory map is the primary
 * lookup; a disk-backed file per account ensures tokens survive gateway restarts.
 *
 * `sendTo` is the last inbound `from_user_id` verbatim. ilink often requires `to_user_id`
 * in sendmessage to match that string exactly (session/cron peer ids are sanitized).
 */
const contextTokenStore = new Map<string, WeixinContextTokenEntry>();

function parsePersistedPeerVal(val: unknown): WeixinContextTokenEntry | null {
  if (typeof val === "string" && val.trim()) {
    return { token: val.trim() };
  }
  if (val && typeof val === "object" && "token" in val) {
    const o = val as { token: unknown; sendTo?: unknown };
    if (typeof o.token !== "string" || !o.token.trim()) return null;
    const sendTo = typeof o.sendTo === "string" && o.sendTo.trim() ? o.sendTo.trim() : undefined;
    return { token: o.token.trim(), ...(sendTo ? { sendTo } : {}) };
  }
  return null;
}

/**
 * Session keys use {@link canonicalWeixinPeerId} (same as `buildSessionKey`); cron `delivery.to`
 * and outbound `ctx.to` use that shape. ilink `from_user_id` is often `…@im.wechat` while the
 * session peer is `…-im-wechat`. Normalize so context_token cache keys match lookups.
 */
function normalizeIlinkUserIdForContext(userId: string): string {
  return canonicalWeixinPeerId(userId);
}

/** ilink may use a shorter openid in one path and a suffixed id in another; treat as same peer when unambiguous. */
function ilinkPeerKeysLikelySame(storedKey: string, queryPeer: string): boolean {
  const a = normalizeIlinkUserIdForContext(storedKey);
  const b = normalizeIlinkUserIdForContext(queryPeer);
  if (a === b) return true;
  if (a.length < 12 || b.length < 12) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function contextTokenKey(accountId: string, userId: string): string {
  return `${normalizeWeixinAccountId(accountId)}:${normalizeIlinkUserIdForContext(userId)}`;
}

// ---------------------------------------------------------------------------
// Disk persistence helpers
// ---------------------------------------------------------------------------

function canonicalContextTokenFilePath(accountId: string): string {
  const norm = normalizeWeixinAccountId(accountId);
  return path.join(resolveWeixinRootDir(), "accounts", `${norm}.context-tokens.json`);
}

/** Older builds wrote `${rawListId}.context-tokens.json`; read both until migrated. */
function listContextTokenFilePathsForRead(accountId: string): string[] {
  const primary = canonicalContextTokenFilePath(accountId);
  const legacy = path.join(
    resolveWeixinRootDir(),
    "accounts",
    `${accountId.trim()}.context-tokens.json`,
  );
  if (path.resolve(primary) === path.resolve(legacy)) {
    return [primary];
  }
  return [primary, legacy];
}

/** Persist all context tokens for a given account to disk (canonical filename only). */
function persistContextTokens(accountId: string): void {
  const norm = normalizeWeixinAccountId(accountId);
  const prefix = `${norm}:`;
  const tokens: Record<string, string | { token: string; sendTo?: string }> = {};
  for (const [k, v] of contextTokenStore) {
    if (k.startsWith(prefix)) {
      const peerSuffix = k.slice(prefix.length);
      if (v.sendTo?.trim()) {
        tokens[peerSuffix] = { token: v.token, sendTo: v.sendTo.trim() };
      } else {
        tokens[peerSuffix] = v.token;
      }
    }
  }
  const filePath = canonicalContextTokenFilePath(accountId);
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(tokens, null, 0), "utf-8");
  } catch (err) {
    logger.warn(`persistContextTokens: failed to write ${filePath}: ${String(err)}`);
  }
}

/**
 * Restore persisted context tokens for an account into the in-memory map.
 * Called once during gateway startAccount to survive restarts.
 */
export function restoreContextTokens(accountId: string): void {
  let count = 0;
  const norm = normalizeWeixinAccountId(accountId);
  for (const filePath of listContextTokenFilePathsForRead(accountId)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf-8");
      const tokens = JSON.parse(raw) as Record<string, unknown>;
      for (const [userId, val] of Object.entries(tokens)) {
        const entry = parsePersistedPeerVal(val);
        if (entry?.token) {
          contextTokenStore.set(contextTokenKey(norm, userId), entry);
          count++;
        }
      }
    } catch (err) {
      logger.warn(`restoreContextTokens: failed to read ${filePath}: ${String(err)}`);
    }
  }
  if (count > 0) {
    logger.info(`restoreContextTokens: restored ${count} tokens for account=${norm}`);
  }
}

/** Remove all context tokens for a given account (memory + disk). */
export function clearContextTokensForAccount(accountId: string): void {
  const norm = normalizeWeixinAccountId(accountId);
  const prefix = `${norm}:`;
  for (const k of [...contextTokenStore.keys()]) {
    if (k.startsWith(prefix)) {
      contextTokenStore.delete(k);
    }
  }
  for (const filePath of listContextTokenFilePathsForRead(accountId)) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn(`clearContextTokensForAccount: failed to remove ${filePath}: ${String(err)}`);
    }
  }
  logger.info(`clearContextTokensForAccount: cleared tokens for account=${norm}`);
}

function tryHydratePeerEntryFromDisk(accountId: string, userId: string): WeixinContextTokenEntry | undefined {
  const peer = normalizeIlinkUserIdForContext(userId);
  const norm = normalizeWeixinAccountId(accountId);
  for (const filePath of listContextTokenFilePathsForRead(accountId)) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const tokens = JSON.parse(raw) as Record<string, unknown>;
      for (const [jsonKey, val] of Object.entries(tokens)) {
        const entry = parsePersistedPeerVal(val);
        if (!entry?.token) continue;
        if (!ilinkPeerKeysLikelySame(jsonKey, peer)) continue;
        contextTokenStore.set(contextTokenKey(norm, peer), entry);
        persistContextTokens(accountId);
        return entry;
      }
    } catch (err) {
      logger.debug(`tryHydratePeerEntryFromDisk: ${filePath}: ${String(err)}`);
    }
  }
  return undefined;
}

function getWeixinContextPeerEntry(
  accountId: string,
  userId: string,
): WeixinContextTokenEntry | undefined {
  const k = contextTokenKey(accountId, userId);
  let e = contextTokenStore.get(k);
  if (e?.token) {
    return e;
  }
  const hydrated = tryHydratePeerEntryFromDisk(accountId, userId);
  if (hydrated) return hydrated;
  return contextTokenStore.get(k);
}

/** Last inbound `from_user_id` for API `to_user_id` (verbatim), when known. */
export function getWeixinOutboundSendUserId(accountId: string, userId: string): string | undefined {
  return getWeixinContextPeerEntry(accountId, userId)?.sendTo?.trim() || undefined;
}

/** Store a context token for a given account+user pair (memory + disk). */
export function setContextToken(
  accountId: string,
  userId: string,
  token: string,
  options?: { sendToUserId?: string },
): void {
  const k = contextTokenKey(accountId, userId);
  const prev = contextTokenStore.get(k);
  const sendTo =
    options && options.sendToUserId !== undefined
      ? options.sendToUserId.trim() || undefined
      : prev?.sendTo;
  const next: WeixinContextTokenEntry = { token, ...(sendTo ? { sendTo } : {}) };
  logger.debug(`setContextToken: key=${k} sendTo=${sendTo ? "yes" : "no"}`);
  contextTokenStore.set(k, next);
  persistContextTokens(accountId);
}

/** Retrieve the cached context token for a given account+user pair. */
export function getContextToken(accountId: string, userId: string): string | undefined {
  const k = contextTokenKey(accountId, userId);
  const e = getWeixinContextPeerEntry(accountId, userId);
  logger.debug(
    `getContextToken: key=${k} found=${e?.token !== undefined} storeSize=${contextTokenStore.size}`,
  );
  return e?.token;
}

/**
 * Find all accountIds that have an active contextToken for the given userId.
 * Used to infer the sending bot account from the recipient address when
 * accountId is not explicitly provided (e.g. cron delivery).
 *
 * Returns all matching accountIds (not just the first) so the caller can
 * detect ambiguity when multiple accounts have sessions with the same user.
 */
export function findAccountIdsByContextToken(
  accountIds: string[],
  userId: string,
): string[] {
  return accountIds.filter((id) => contextTokenStore.has(contextTokenKey(id, userId)));
}

/** In-memory entries whose peer id matches (exact or ilink prefix/suffix variant). */
export function findContextTokenEntriesByPeer(
  peerUserId: string,
): Array<{ accountId: string; token: string; sendTo?: string }> {
  const peer = normalizeIlinkUserIdForContext(peerUserId);
  const out: Array<{ accountId: string; token: string; sendTo?: string }> = [];
  for (const [k, entry] of contextTokenStore) {
    if (!entry?.token?.trim()) continue;
    const idx = k.indexOf(':');
    if (idx <= 0 || idx >= k.length - 1) continue;
    const accountId = k.slice(0, idx);
    const storedPeer = k.slice(idx + 1);
    if (!ilinkPeerKeysLikelySame(storedPeer, peer)) continue;
    if (accountId) {
      out.push({
        accountId,
        token: entry.token,
        ...(entry.sendTo?.trim() ? { sendTo: entry.sendTo.trim() } : {}),
      });
    }
  }
  return out;
}

/**
 * When the preferred account id does not match the token filename, scan every
 * `accounts/*.context-tokens.json` for this peer (case-insensitive user key).
 */
export function tryHydrateAnyAccountContextTokenFromDisk(
  peerUserId: string,
): { accountId: string; token: string; sendTo?: string } | undefined {
  const peer = normalizeIlinkUserIdForContext(peerUserId);
  const accountsDir = path.join(resolveWeixinRootDir(), 'accounts');
  if (!fs.existsSync(accountsDir)) return undefined;
  const hits: Array<{ accountId: string; token: string; sendTo?: string }> = [];
  let names: string[];
  try {
    names = fs.readdirSync(accountsDir);
  } catch {
    return undefined;
  }
  const suffix = '.context-tokens.json';
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    const accountFromFile = name.slice(0, -suffix.length);
    const filePath = path.join(accountsDir, name);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const tokens = JSON.parse(raw) as Record<string, unknown>;
      for (const [jsonKey, val] of Object.entries(tokens)) {
        const entry = parsePersistedPeerVal(val);
        if (!entry?.token) continue;
        if (!ilinkPeerKeysLikelySame(jsonKey, peer)) continue;
        hits.push({
          accountId: normalizeWeixinAccountId(accountFromFile),
          token: entry.token,
          ...(entry.sendTo?.trim() ? { sendTo: entry.sendTo.trim() } : {}),
        });
      }
    } catch {
      /* skip corrupt file */
    }
  }
  if (hits.length === 0) return undefined;
  const byAccount = new Map<string, { token: string; sendTo?: string }>();
  for (const h of hits) {
    if (!byAccount.has(h.accountId)) byAccount.set(h.accountId, { token: h.token, sendTo: h.sendTo });
  }
  if (byAccount.size > 1) return undefined;
  const [accountId, hit] = [...byAccount.entries()][0]!;
  setContextToken(accountId, peer, hit.token, hit.sendTo ? { sendToUserId: hit.sendTo } : undefined);
  return { accountId, token: hit.token, sendTo: hit.sendTo };
}

// ---------------------------------------------------------------------------
// Message ID generation
// ---------------------------------------------------------------------------

function generateMessageSid(): string {
  return generateId("weixin");
}

/** Inbound context passed to the OpenClaw core pipeline (matches MsgContext shape). */
export type WeixinMsgContext = {
  Body: string;
  From: string;
  To: string;
  AccountId: string;
  OriginatingChannel: "weixin";
  OriginatingTo: string;
  MessageSid: string;
  Timestamp?: number;
  Provider: "weixin";
  ChatType: "direct";
  /** Set by monitor after resolveAgentRoute so dispatchReplyFromConfig uses the correct session. */
  SessionKey?: string;
  context_token?: string;
  MediaUrl?: string;
  MediaPath?: string;
  MediaType?: string;
  /** Raw message body for framework command authorization. */
  CommandBody?: string;
  /** Whether the sender is authorized to execute slash commands. */
  CommandAuthorized?: boolean;
};

/** Returns true if the message item is a media type (image, video, file, or voice). */
export function isMediaItem(item: MessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  );
}

function bodyFromItemList(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      // Quoted media is passed as MediaPath; only include the current text as body.
      if (ref.message_item && isMediaItem(ref.message_item)) return text;
      // Build quoted context from both title and message_item content.
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (ref.message_item) {
        const refBody = bodyFromItemList([ref.message_item]);
        if (refBody) parts.push(refBody);
      }
      if (!parts.length) return text;
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    // 语音转文字：如果语音消息有 text 字段，直接使用文字内容
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

export type WeixinInboundMediaOpts = {
  /** Local path to decrypted image file. */
  decryptedPicPath?: string;
  /** Local path to transcoded/raw voice file (.wav or .silk). */
  decryptedVoicePath?: string;
  /** MIME type for the voice file (e.g. "audio/wav" or "audio/silk"). */
  voiceMediaType?: string;
  /** Local path to decrypted file attachment. */
  decryptedFilePath?: string;
  /** MIME type for the file attachment (guessed from file_name). */
  fileMediaType?: string;
  /** Local path to decrypted video file. */
  decryptedVideoPath?: string;
};

/**
 * Convert a WeixinMessage from getUpdates to the inbound MsgContext for the core pipeline.
 * Media: only pass MediaPath (local file, after CDN download + decrypt).
 * We never pass MediaUrl — the upstream CDN URL is encrypted/auth-only.
 * Priority when multiple media types present: image > video > file > voice.
 */
export function weixinMessageToMsgContext(
  msg: WeixinMessage,
  accountId: string,
  opts?: WeixinInboundMediaOpts,
): WeixinMsgContext {
  const from_user_id = msg.from_user_id ?? "";
  const ctx: WeixinMsgContext = {
    Body: bodyFromItemList(msg.item_list),
    From: from_user_id,
    To: from_user_id,
    AccountId: accountId,
    OriginatingChannel: "weixin",
    OriginatingTo: from_user_id,
    MessageSid: generateMessageSid(),
    Timestamp: msg.create_time_ms,
    Provider: "weixin",
    ChatType: "direct",
  };
  if (msg.context_token) {
    ctx.context_token = msg.context_token;
  }

  if (opts?.decryptedPicPath) {
    ctx.MediaPath = opts.decryptedPicPath;
    ctx.MediaType = "image/*";
  } else if (opts?.decryptedVideoPath) {
    ctx.MediaPath = opts.decryptedVideoPath;
    ctx.MediaType = "video/mp4";
  } else if (opts?.decryptedFilePath) {
    ctx.MediaPath = opts.decryptedFilePath;
    ctx.MediaType = opts.fileMediaType ?? "application/octet-stream";
  } else if (opts?.decryptedVoicePath) {
    ctx.MediaPath = opts.decryptedVoicePath;
    ctx.MediaType = opts.voiceMediaType ?? "audio/wav";
  }

  return ctx;
}

/** Extract the context_token from an inbound WeixinMsgContext. */
export function getContextTokenFromMsgContext(ctx: WeixinMsgContext): string | undefined {
  return ctx.context_token;
}
