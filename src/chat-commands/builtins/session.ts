/**
 * Session Commands
 * 
 * Built-in commands for session management:
 * - /new - Start a new session
 * - /list - List all sessions
 * - /switch - Switch to a different session
 * - /clear - Clear current session without archiving
 * - /abort - Cancel in-flight assistant reply (generation / streaming)
 */

import type { CommandDefinition, CommandContext, UIComponent } from '../types.js';
import { commandRegistry } from '../registry.js';
import { getSessionDisplayName } from '../session-key.js';

const newCommand: CommandDefinition = {
  id: 'session.new',
  name: 'new',
  aliases: ['reset', 'restart'],
  description: 'Start a new session (archive current)',
  category: 'session',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    await ctx.setTyping(true);
    
    await ctx.resetSession();
    
    // Note: resetSession already sends confirmation message
    return {
      content: '',
      success: true,
    };
  },
};

const listCommand: CommandDefinition = {
  id: 'session.list',
  name: 'list',
  aliases: ['sessions'],
  description: 'List all your sessions',
  category: 'session',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    await ctx.setTyping(true);
    
    const sessions = await ctx.listSessions();
    
    if (sessions.length === 0) {
      return {
        content: '📋 No sessions found.',
        success: true,
      };
    }
    
    // Sort by updatedAt desc
    sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    
    // Build text response
    const lines = sessions.slice(0, 10).map(s => {
      const indicator = s.isActive ? '▶️' : '  ';
      const name = getSessionDisplayName(s.key);
      const date = s.updatedAt.toLocaleDateString();
      return `${indicator} ${name}\n   ${s.messageCount} messages · ${date}`;
    });
    
    const content = '📋 Your Sessions:\n\n' + lines.join('\n\n');
    
    // Create UI component if supported
    if (ctx.supports('buttons')) {
      const component: UIComponent = {
        type: 'session-list',
        sessions: sessions.slice(0, 5).map(s => ({
          ...s,
          name: getSessionDisplayName(s.key),
        })),
        currentSession: ctx.sessionKey,
      };
      
      return {
        content,
        success: true,
        components: [component],
      };
    }
    
    return {
      content,
      success: true,
    };
  },
};

const clearCommand: CommandDefinition = {
  id: 'session.clear',
  name: 'clear',
  description: 'Clear current session without archiving',
  category: 'session',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    await ctx.setTyping(true);
    
    // Just delete without archiving
    const messages = await ctx.getSession();
    await ctx.clearSession();
    
    return {
      content: `🗑️ Session cleared. ${messages.length} messages deleted.`,
      success: true,
    };
  },
};

const abortCommand: CommandDefinition = {
  id: 'session.abort',
  name: 'abort',
  aliases: ['stop', 'cancel'],
  description: 'Stop the current assistant reply (in-flight generation or stream)',
  category: 'session',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    if (!ctx.abortCurrentTurn) {
      return {
        content: 'Abort is not available in this environment.',
        success: false,
      };
    }
    await ctx.abortCurrentTurn();
    return {
      content: '⏹️ Current reply cancelled.',
      success: true,
    };
  },
};

const compactCommand: CommandDefinition = {
  id: 'session.compact',
  name: 'compact',
  description: 'Compact session history (LLM summary + keep recent turns) to save context',
  category: 'session',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/compact', '/compact focus on API design'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);
    const instructions = args.trim() || undefined;
    const result = await ctx.compactSession?.({ instructions, force: true });
    if (result === null || result === undefined) {
      return {
        content: '⚠️ Session compaction is not available in this environment.',
        success: false,
      };
    }
    if (!result.compacted) {
      return {
        content:
          'ℹ️ Nothing to compact yet. Need at least two messages, or the session is already small.\n' +
          'Tip: add optional focus text, e.g. `/compact emphasize decisions about auth`.',
        success: true,
      };
    }
    const preview =
      result.summary && result.summary.length > 600
        ? `${result.summary.slice(0, 600)}…`
        : result.summary || '';
    return {
      content:
        `🗜️ *Session compacted*\n\n` +
        `Tokens (approx): ${result.tokensBefore} → ${result.tokensAfter}\n\n` +
        (preview ? `*Summary:*\n${preview}` : ''),
      success: true,
    };
  },
};

const btwCommand: CommandDefinition = {
  id: 'session.btw',
  name: 'btw',
  aliases: ['aside'],
  description: 'Ask a side question without adding to the session transcript',
  category: 'session',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/btw What does that error code mean?', '/aside Summarize the last topic in one line'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);
    const q = args.trim();
    if (!q) {
      return {
        content:
          '💬 *Side question*\n\n' +
          'Usage: `/btw <question>`\n' +
          'Answers use your current chat as background only; the reply is not saved to the session.',
        success: true,
      };
    }
    const out = await ctx.btwQuery?.(q);
    if (!out) {
      return { content: '⚠️ /btw is not available here.', success: false };
    }
    if (out.error) {
      return { content: `⚠️ ${out.error}`, success: false };
    }
    return { content: `💬 *BTW*\n\n${out.text}`, success: true };
  },
};

const exportSessionCommand: CommandDefinition = {
  id: 'session.export',
  name: 'export-session',
  aliases: ['export'],
  description: 'Export this session to workspace exports/ (markdown, html, or json)',
  category: 'session',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/export-session', '/export-session html', '/export json'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);
    const raw = args.trim().toLowerCase();
    const fmt =
      raw === 'json' || raw === 'html' || raw === 'markdown'
        ? (raw as 'json' | 'html' | 'markdown')
        : 'markdown';
    if (!ctx.exportSessionToWorkspace) {
      return { content: '⚠️ Export is not available in this environment.', success: false };
    }
    try {
      const { path } = await ctx.exportSessionToWorkspace(fmt);
      return {
        content: `📄 Exported (${fmt}) to:\n\`${path}\``,
        success: true,
      };
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      return { content: `⚠️ Export failed: ${em}`, success: false };
    }
  },
};

const archiveCommand: CommandDefinition = {
  id: 'session.archive',
  name: 'archive',
  description: 'Archive current session',
  category: 'session',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    await ctx.setTyping(true);
    
    await ctx.archiveSession();
    
    return {
      content: '📦 Current session has been archived.',
      success: true,
    };
  },
};

// Register all session commands
export function registerSessionCommands(): void {
  commandRegistry.register(newCommand);
  commandRegistry.register(listCommand);
  commandRegistry.register(clearCommand);
  commandRegistry.register(abortCommand);
  commandRegistry.register(compactCommand);
  commandRegistry.register(btwCommand);
  commandRegistry.register(exportSessionCommand);
  commandRegistry.register(archiveCommand);
}
