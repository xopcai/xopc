import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Message, LLMMessage } from '../types/index.js';
import { SessionManager } from '../session/index.js';
import { SkillsLoader } from './skills.js';

const BOOTSTRAP_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'];

export class ContextBuilder {
  private skillsLoader: SkillsLoader;

  constructor(
    private workspace: string,
    private sessionManager: SessionManager
  ) {
    this.skillsLoader = new SkillsLoader(workspace);
  }

  buildSystemPrompt(skillNames?: string[]): string {
    const parts: string[] = [];
    
    // Core identity
    parts.push(this.getIdentity());
    
    // Skills summary
    const skillsSummary = this.skillsLoader.buildSkillsSummary();
    if (skillsSummary) {
      parts.push(`# Skills\n\n${skillsSummary}`);
    }
    
    // Load specific skills if requested
    if (skillNames && skillNames.length > 0) {
      const skillsContent = this.skillsLoader.loadSkillsContent(skillNames);
      if (skillsContent) {
        parts.push(`# Active Skills\n\n${skillsContent}`);
      }
    }
    
    // Bootstrap files
    const bootstrap = this.loadBootstrapFiles();
    if (bootstrap) {
      parts.push(bootstrap);
    }
    
    // Memory context
    const memory = this.getMemoryContext();
    if (memory) {
      parts.push(`# Memory\n\n${memory}`);
    }
    
    return parts.join('\n\n---\n\n');
  }

  private getIdentity(): string {
    const now = new Date().toISOString().split('T')[0];
    const workspacePath = this.workspace;
    
    return `# xopcbot

You are xopcbot, a helpful AI assistant. You have access to tools that allow you to:
- Read, write, and edit files
- Execute shell commands
- Search the web and fetch web pages
- Send messages to users on chat channels
- Spawn subagents for complex background tasks
- Use skills to extend your capabilities

## Current Time
${now}

## Workspace
Your workspace is at: ${workspacePath}
- Memory files: ${workspacePath}/memory/MEMORY.md
- Daily notes: ${workspacePath}/memory/YYYY-MM-DD.md
- Custom skills: ${workspacePath}/skills/<skill-name>/SKILL.md

## Using Skills
You have access to skills that provide specialized capabilities. Skills are located at:
- Built-in: <agent>/skills/<skill-name>/SKILL.md
- Custom: ${workspacePath}/skills/<skill-name>/SKILL.md

IMPORTANT: When responding to direct questions or conversations, reply directly with your text response.
Only use the 'message' tool when you need to send a message to a specific chat channel.
For normal conversation, just respond with text - do not call the message tool.

Always be helpful, accurate, and concise.`;
  }

  private loadBootstrapFiles(): string {
    const parts: string[] = [];
    
    for (const filename of BOOTSTRAP_FILES) {
      const filePath = join(this.workspace, filename);
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          parts.push(`## ${filename}\n\n${content}`);
        } catch {
          // Skip if can't read
        }
      }
    }
    
    return parts.join('\n\n');
  }

  private getMemoryContext(): string {
    const parts: string[] = [];
    
    // Long-term memory
    const memoryPath = join(this.workspace, 'memory', 'MEMORY.md');
    if (existsSync(memoryPath)) {
      try {
        const longTerm = readFileSync(memoryPath, 'utf-8');
        if (longTerm.trim()) {
          parts.push(`## Long-term Memory\n${longTerm}`);
        }
      } catch {
        // Skip
      }
    }
    
    // Today's notes
    const today = new Date().toISOString().split('T')[0];
    const todayPath = join(this.workspace, 'memory', `${today}.md`);
    if (existsSync(todayPath)) {
      try {
        const todayNotes = readFileSync(todayPath, 'utf-8');
        if (todayNotes.trim()) {
          parts.push(`## Today's Notes\n${todayNotes}`);
        }
      } catch {
        // Skip
      }
    }
    
    return parts.join('\n\n');
  }

  buildMessages(
    history: Message[],
    currentMessage: string,
    media?: string[]
  ): LLMMessage[] {
    const messages: LLMMessage[] = [];
    
    // System prompt
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(),
    });
    
    // History
    for (const msg of history.slice(-50)) {
      messages.push({
        role: msg.role as 'user' | 'assistant' | 'tool',
        content: msg.content,
      });
    }
    
    // Current message
    messages.push({
      role: 'user',
      content: currentMessage,
    });
    
    return messages;
  }

  addToolResult(
    messages: LLMMessage[],
    toolCallId: string,
    toolName: string,
    result: string
  ): LLMMessage[] {
    messages.push({
      role: 'toolResult' as const,
      toolCallId,
      toolName,
      content: [{ type: 'text' as const, text: result }],
      isError: false,
      timestamp: Date.now(),
    });
    return messages;
  }

  addAssistantMessage(
    messages: LLMMessage[],
    content: string,
    toolCalls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>
  ): LLMMessage[] {
    const msg: LLMMessage = {
      role: 'assistant',
      content,
    };
    
    if (toolCalls && toolCalls.length > 0) {
      msg.tool_calls = toolCalls as Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }
    
    messages.push(msg);
    return messages;
  }
}
