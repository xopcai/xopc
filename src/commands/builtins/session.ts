/**
 * Session Commands
 * 
 * Built-in commands for session management:
 * - /new - Start a new session
 * - /list - List all sessions
 * - /switch - Switch to a different session
 * - /clear - Clear current session without archiving
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
    
    await ctx.clearSession();
    
    // Note: clearSession already sends confirmation message
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
  commandRegistry.register(archiveCommand);
}
