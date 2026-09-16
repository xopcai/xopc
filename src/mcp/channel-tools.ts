import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { XopcChannelBridge } from './channel-bridge.js';
import {
  extractAttachmentsFromMessage,
  resolveMessageId,
  summarizeResult,
  toText,
} from "./channel-shared.js";

export function getChannelMcpCapabilities(claudeChannelMode: "off" | "on" | "auto") {
  if (claudeChannelMode === "off") {
    return undefined;
  }
  return {
    experimental: {
      "claude/channel": {},
      "claude/channel/permission": {},
    },
  };
}

export function registerChannelMcpTools(server: McpServer, bridge: XopcChannelBridge): void {
  server.tool(
    'conversations_list',
    'List xopc channel-backed conversations available through session routes.',
    {
      limit: z.number().int().min(1).max(500).optional(),
      search: z.string().optional(),
      channel: z.string().optional(),
      includeDerivedTitles: z.boolean().optional(),
      includeLastMessage: z.boolean().optional(),
    },
    async (args) => {
      const conversations = await bridge.listConversations(args);
      return {
        ...summarizeResult("conversations", conversations.length),
        structuredContent: { conversations },
      };
    },
  );

  server.tool(
    "conversation_get",
    "Get one OpenClaw conversation by session key.",
    { conversation_id: z.string().min(1) },
    async ({ conversation_id }) => {
      const conversation = await bridge.getConversation(conversation_id);
      if (!conversation) {
        return {
          content: [{ type: "text", text: `conversation not found: ${conversation_id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `conversation ${conversation.conversationId}` }],
        structuredContent: { conversation },
      };
    },
  );

  server.tool(
    "messages_read",
    "Read recent messages for one OpenClaw conversation.",
    {
      conversation_id: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ conversation_id, limit }) => {
      const messages = await bridge.readMessages(conversation_id, limit ?? 20);
      return {
        ...summarizeResult("messages", messages.length),
        structuredContent: { messages },
      };
    },
  );

  server.tool(
    "attachments_fetch",
    "List non-text attachments for a message in one OpenClaw conversation.",
    {
      conversation_id: z.string().min(1),
      message_id: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ conversation_id, message_id, limit }) => {
      const messages = await bridge.readMessages(conversation_id, limit ?? 100);
      const message = messages.find((entry) => resolveMessageId(entry) === message_id);
      if (!message) {
        return {
          content: [{ type: "text", text: `message not found: ${message_id}` }],
          isError: true,
        };
      }
      const attachments = extractAttachmentsFromMessage(message);
      return {
        ...summarizeResult("attachments", attachments.length),
        structuredContent: { attachments, message },
      };
    },
  );

  server.tool(
    "events_poll",
    "Poll queued OpenClaw conversation events since a cursor.",
    {
      after_cursor: z.number().int().min(0).optional(),
      conversation_id: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ after_cursor, conversation_id, limit }) => {
      const { events, nextCursor } = bridge.pollEvents(
        { afterCursor: after_cursor ?? 0, conversationId: toText(conversation_id) },
        limit ?? 20,
      );
      return {
        ...summarizeResult("events", events.length),
        structuredContent: { events, next_cursor: nextCursor },
      };
    },
  );

  server.tool(
    "events_wait",
    "Wait for the next queued OpenClaw conversation event.",
    {
      after_cursor: z.number().int().min(0).optional(),
      conversation_id: z.string().optional(),
      timeout_ms: z.number().int().min(1).max(300_000).optional(),
    },
    async ({ after_cursor, conversation_id, timeout_ms }) => {
      const event = await bridge.waitForEvent(
        { afterCursor: after_cursor ?? 0, conversationId: toText(conversation_id) },
        timeout_ms ?? 30_000,
      );
      return {
        content: [{ type: "text", text: event ? `event ${event.cursor}` : "timeout" }],
        structuredContent: { event },
      };
    },
  );

  server.tool(
    "messages_send",
    "Send a message back through the same OpenClaw conversation route.",
    {
      conversation_id: z.string().min(1),
      text: z.string().min(1),
    },
    async ({ conversation_id, text }) => {
      const result = await bridge.sendMessage({ conversationId: conversation_id, text });
      return {
        content: [{ type: "text", text: "sent" }],
        structuredContent: { result },
      };
    },
  );

  server.tool(
    "permissions_list_open",
    "List open OpenClaw exec or plugin approval requests visible through the Gateway.",
    {},
    async () => {
      const approvals = bridge.listPendingApprovals();
      return {
        ...summarizeResult("approvals", approvals.length),
        structuredContent: { approvals },
      };
    },
  );

  server.tool(
    "permissions_respond",
    "Allow or deny one pending OpenClaw exec or plugin approval request.",
    {
      kind: z.enum(["exec", "plugin"]),
      id: z.string().min(1),
      decision: z.enum(["allow-once", "allow-always", "deny"]),
    },
    async ({ kind, id, decision }) => {
      const result = await bridge.respondToApproval({ kind, id, decision });
      return {
        content: [{ type: "text", text: "approval resolved" }],
        structuredContent: { result },
      };
    },
  );
}
