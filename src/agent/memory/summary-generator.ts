/**
 * Summary Generator - Generates structured summaries for context compaction
 * 
 * Creates structured summaries that preserve:
 * - User requests and intents
 * - Tool call history (deduplicated by file path)
 * - Key decisions and outcomes
 * - Modified files list
 * - Usage statistics
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { ToolResultMessage, Message } from '@mariozechner/pi-ai';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SummaryGenerator');

export interface ToolCallSummary {
  toolName: string;
  filePath?: string;
  operation: 'read' | 'write' | 'search' | 'shell' | 'other';
  success: boolean;
  briefResult?: string;
  timestamp?: number;
}

export interface ConversationSummary {
  userRequests: string[];        // User's core requests
  toolCalls: ToolCallSummary[];  // Tool call history
  keyDecisions: string[];        // Key decisions made
  filesModified: string[];       // List of modified files
  totalToolCalls: number;        // Total tool calls (before dedup)
  successfulToolCalls: number;   // Successful tool calls
  failedToolCalls: number;       // Failed tool calls
}

export interface SummaryGenerationOptions {
  maxUserRequests: number;       // Max user requests to keep (default: 10)
  maxToolCalls: number;          // Max tool calls to keep after dedup (default: 50)
  deduplicateByFile: boolean;    // Deduplicate tool calls by file path (default: true)
  includeUsage: boolean;         // Include usage statistics (default: true)
}

const DEFAULT_OPTIONS: SummaryGenerationOptions = {
  maxUserRequests: 10,
  maxToolCalls: 50,
  deduplicateByFile: true,
  includeUsage: true,
};

/**
 * Categorize tool operation based on tool name
 */
function categorizeToolOperation(toolName: string): 'read' | 'write' | 'search' | 'shell' | 'other' {
  const name = toolName.toLowerCase();
  
  if (['read', 'read_file', 'read_multiple', 'glob', 'list_dir', 'ls', 'memory_get'].some(n => name.includes(n))) {
    return 'read';
  }
  
  if (['write', 'write_file', 'write_multiple', 'edit', 'patch', 'create', 'mkdir'].some(n => name.includes(n))) {
    return 'write';
  }
  
  if (['grep', 'search', 'find', 'find_files', 'memory_search', 'web_search'].some(n => name.includes(n))) {
    return 'search';
  }
  
  if (['bash', 'shell', 'exec', 'run', 'command'].some(n => name.includes(n))) {
    return 'shell';
  }
  
  return 'other';
}

/**
 * Extract text content from message
 */
function extractTextContent(content: AgentMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => (c as { text?: string }).text || '')
      .join('\n');
  }
  
  return '';
}

/**
 * Type guard: Check if message has tool calls (assistant message)
 */
function hasToolCalls(msg: AgentMessage): msg is AgentMessage & { toolCalls?: unknown[] } {
  return msg.role === 'assistant' && 'toolCalls' in msg;
}

/**
 * Type guard: Check if message is a tool result
 */
function isToolResult(msg: AgentMessage): msg is AgentMessage & { name?: string; role: 'toolResult' } {
  return msg.role === 'toolResult' && 'name' in msg;
}

/**
 * Deduplicate tool calls by file path (keep last operation per file)
 */
function deduplicateByFilePath(toolCalls: ToolCallSummary[]): ToolCallSummary[] {
  const byFile = new Map<string, ToolCallSummary>();
  const otherCalls: ToolCallSummary[] = [];

  for (const call of toolCalls) {
    if (call.filePath) {
      // Keep the last operation for each file
      byFile.set(call.filePath, call);
    } else {
      // Keep all non-file operations
      otherCalls.push(call);
    }
  }

  return [...Array.from(byFile.values()), ...otherCalls];
}

/**
 * Generate structured summary from messages
 */
export function generateStructuredSummary(
  messages: AgentMessage[],
  options: Partial<SummaryGenerationOptions> = {}
): ConversationSummary {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const summary: ConversationSummary = {
    userRequests: [],
    toolCalls: [],
    keyDecisions: [],
    filesModified: [],
    totalToolCalls: 0,
    successfulToolCalls: 0,
    failedToolCalls: 0,
  };

  let lastAssistantMessage: AgentMessage | null = null;

  for (const msg of messages) {
    // Extract user requests
    if (msg.role === 'user') {
      const text = extractTextContent(msg.content);
      if (text.trim().length > 20) {
        summary.userRequests.push(text.slice(0, 500)); // Limit each request length
      }
    }

    // Extract tool calls from assistant messages
    if (hasToolCalls(msg)) {
      lastAssistantMessage = msg;
      
      const toolCalls = (msg as Message & { toolCalls?: Array<{ name: string; args?: Record<string, unknown> }> }).toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        summary.totalToolCalls += toolCalls.length;

        for (const call of toolCalls) {
          const toolSummary: ToolCallSummary = {
            toolName: call.name,
            operation: categorizeToolOperation(call.name),
            success: true, // Will be updated from tool_result
            filePath: String(call.args?.path || call.args?.file_path || call.args?.filePath || ''),
            timestamp: msg.timestamp,
          };
          summary.toolCalls.push(toolSummary);

          if (['write', 'edit'].includes(toolSummary.operation) && toolSummary.filePath) {
            summary.filesModified.push(toolSummary.filePath);
          }
        }
      }
    }

    // Extract tool results to determine success/failure
    if (isToolResult(msg)) {
      const toolMsg = msg as ToolResultMessage;
      const toolName = toolMsg.toolName;
      
      // Find the corresponding tool call and update success status
      const toolCall = summary.toolCalls
        .slice()
        .reverse()
        .find((tc: ToolCallSummary) => tc.toolName === toolName && !tc.timestamp); // Match by name, prefer unmatched
      
      if (toolCall) {
        const resultText = extractTextContent(toolMsg.content);
        
        // Detect failure from result content
        const isError = resultText.toLowerCase().includes('error') || 
                       resultText.toLowerCase().includes('failed') ||
                       resultText.startsWith('Error:');
        
        toolCall.success = !isError;
        toolCall.briefResult = resultText.slice(0, 200);

        if (isError) {
          summary.failedToolCalls++;
        } else {
          summary.successfulToolCalls++;
        }
      }
    }
  }

  // Deduplicate tool calls by file path if enabled
  if (opts.deduplicateByFile) {
    summary.toolCalls = deduplicateByFilePath(summary.toolCalls);
  }

  // Limit tool calls
  if (summary.toolCalls.length > opts.maxToolCalls) {
    summary.toolCalls = summary.toolCalls.slice(-opts.maxToolCalls);
  }

  // Limit user requests
  if (summary.userRequests.length > opts.maxUserRequests) {
    summary.userRequests = summary.userRequests.slice(-opts.maxUserRequests);
  }

  // Deduplicate files modified
  summary.filesModified = [...new Set(summary.filesModified)];

  // Extract key decisions from last assistant message
  if (lastAssistantMessage) {
    const decisions = extractKeyDecisions(lastAssistantMessage);
    summary.keyDecisions = decisions;
  }

  log.debug(
    {
      userRequests: summary.userRequests.length,
      toolCalls: summary.toolCalls.length,
      filesModified: summary.filesModified.length,
      totalToolCalls: summary.totalToolCalls,
      successfulToolCalls: summary.successfulToolCalls,
      failedToolCalls: summary.failedToolCalls,
    },
    'Generated structured summary'
  );

  return summary;
}

/**
 * Extract key decisions from assistant message
 */
function extractKeyDecisions(msg: AgentMessage): string[] {
  const content = extractTextContent(msg.content);
  const decisions: string[] = [];

  // Look for decision patterns
  const decisionPatterns = [
    /(?:I'll|I will|Let's|We should|Decision:|Decided to|Chose to)\s+(.+?)(?:\.|\n)/gi,
    /(?:Based on|After analyzing|Given that)\s+(.+?)(?:\.|\n)/gi,
    /(?:The best approach|The solution|The answer) is\s+(.+?)(?:\.|\n)/gi,
  ];

  for (const pattern of decisionPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      decisions.push(...matches.slice(0, 5).map(m => m.trim()));
    }
  }

  // Limit decisions
  return decisions.slice(0, 10);
}

/**
 * Format structured summary as text for injection into context
 */
export function formatSummaryAsText(summary: ConversationSummary, includeUsage: boolean = true): string {
  const lines: string[] = [];

  lines.push('[Previous Conversation Summary]');

  // User requests
  if (summary.userRequests.length > 0) {
    lines.push('');
    lines.push('User Requests:');
    for (const req of summary.userRequests.slice(-5)) {
      lines.push(`  - ${req.slice(0, 150)}${req.length > 150 ? '...' : ''}`);
    }
  }

  // Tool calls summary
  if (summary.toolCalls.length > 0) {
    lines.push('');
    lines.push('Tool Operations:');
    
    // Group by operation type
    const byType = new Map<string, ToolCallSummary[]>();
    for (const call of summary.toolCalls) {
      const list = byType.get(call.operation) || [];
      list.push(call);
      byType.set(call.operation, list);
    }

    for (const [type, calls] of byType.entries()) {
      const files = calls.filter(c => c.filePath).map(c => c.filePath!);
      const successCount = calls.filter(c => c.success).length;
      lines.push(`  ${type.toUpperCase()}: ${calls.length} operations (${successCount}/${calls.length} successful)`);
      if (files.length > 0) {
        lines.push(`    Files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
      }
    }
  }

  // Files modified
  if (summary.filesModified.length > 0) {
    lines.push('');
    lines.push('Files Modified:');
    for (const file of summary.filesModified.slice(-10)) {
      lines.push(`  - ${file}`);
    }
  }

  // Key decisions
  if (summary.keyDecisions.length > 0) {
    lines.push('');
    lines.push('Key Decisions:');
    for (const decision of summary.keyDecisions.slice(-5)) {
      lines.push(`  - ${decision}`);
    }
  }

  // Usage statistics
  if (includeUsage) {
    lines.push('');
    lines.push('Statistics:');
    lines.push(`  Total tool calls: ${summary.totalToolCalls}`);
    lines.push(`  Successful: ${summary.successfulToolCalls}`);
    lines.push(`  Failed: ${summary.failedToolCalls}`);
    lines.push(`  Files modified: ${summary.filesModified.length}`);
  }

  return lines.join('\n');
}

/**
 * Generate compact summary message for context injection
 */
export function createSummaryMessage(summary: ConversationSummary): AgentMessage {
  const text = formatSummaryAsText(summary, true);
  
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}
