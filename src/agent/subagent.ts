import { v4 as uuidv4 } from 'uuid';
import { ToolRegistry } from './tools/index.js';
import { ReadFileTool, WriteFileTool, ListDirTool } from './tools/index.js';
import { ExecTool } from './tools/shell.js';
import { WebSearchTool, WebFetchTool } from './tools/index.js';
import { InboundMessage, LLMMessage } from '../types/index.js';
import { MessageBus } from '../bus/index.js';
import { LLMProvider } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SubagentManager');

export class SubagentManager {
  private runningTasks: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private provider: LLMProvider,
    private workspace: string,
    private bus: MessageBus,
    private model?: string
  ) {}

  async spawn(
    task: string,
    label?: string,
    originChannel = 'cli',
    originChatId = 'direct'
  ): Promise<string> {
    const taskId = uuidv4().slice(0, 8);
    const displayLabel = label || task.slice(0, 30) + (task.length > 30 ? '...' : '');
    
    const timeout = setTimeout(() => this.handleTimeout(taskId, displayLabel), 300000);
    this.runningTasks.set(taskId, timeout);
    
    this.runSubagent(taskId, task, displayLabel, originChannel, originChatId);
    
    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`;
  }

  private async runSubagent(
    taskId: string,
    task: string,
    label: string,
    originChannel: string,
    originChatId: string
  ): Promise<void> {
    try {
      const tools = new ToolRegistry();
      tools.register(new ReadFileTool());
      tools.register(new WriteFileTool());
      tools.register(new ListDirTool());
      tools.register(new ExecTool(this.workspace));
      tools.register(new WebSearchTool(process.env.BRAVE_SEARCH_API_KEY));
      tools.register(new WebFetchTool());

      const systemPrompt = this.buildSubagentPrompt(task);
      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ];

      const maxIterations = 15;
      let iteration = 0;
      let finalResult: string | null = null;
      const defaultModel = this.model || this.provider.getDefaultModel();

      while (iteration < maxIterations) {
        iteration++;
        
        const toolDefs = tools.getDefinitions().map(t => t.function);

        const response = await this.provider.chat(
          messages,
          toolDefs,
          defaultModel,
          4096,
          0.7
        );

        if (response.tool_calls.length > 0) {
          const toolCallsForMessage = response.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
          
          messages.push({
            role: 'assistant' as const,
            content: response.content || '',
            tool_calls: toolCallsForMessage,
          });

          for (const tc of response.tool_calls) {
            log.debug({ tool: tc.function.name, taskId }, 'Executing tool');
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              // Keep empty object if parsing fails
            }
            const result = await tools.execute(tc.function.name, args);
            messages.push({ role: 'tool' as const, content: result });
          }
        } else {
          finalResult = response.content;
          break;
        }
      }

      if (!finalResult) {
        finalResult = 'Task completed but no final response was generated.';
      }

      await this.announceResult(taskId, label, task, finalResult, originChannel, originChatId);
      
    } catch (error) {
      const errorMsg = `Error: ${error instanceof Error ? error.message : String(error)}`;
      await this.announceResult(taskId, label, task, errorMsg, originChannel, originChatId, 'error');
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  private async announceResult(
    taskId: string,
    label: string,
    task: string,
    result: string,
    originChannel: string,
    originChatId: string,
    status: 'ok' | 'error' = 'ok'
  ): Promise<void> {
    const statusText = status === 'ok' ? 'completed successfully' : 'failed';
    
    const announceContent = `[Subagent '${label}' ${statusText}]

Task: ${task}

Result:
${result}

Summarize this naturally for the user. Keep it brief (1-2 sentences).`;

    const msg: InboundMessage = {
      channel: 'system',
      sender_id: 'subagent',
      chat_id: `${originChannel}:${originChatId}`,
      content: announceContent,
    };

    await this.bus.publishInbound(msg);
  }

  private buildSubagentPrompt(task: string): string {
    return `# Subagent

You are a subagent spawned by the main agent to complete a specific task.

## Your Task
${task}

## Rules
1. Stay focused - complete only the assigned task
2. Your final response will be reported back to the main agent
3. Be concise but informative

## What You Can Do
- Read and write files in the workspace
- Execute shell commands
- Search the web and fetch web pages

## What You Cannot Do
- Send messages directly to users (no message tool available)
- Spawn other subagents

## Workspace
Your workspace is at: ${this.workspace}

When you have completed the task, provide a clear summary.`;
  }

  private handleTimeout(taskId: string, label: string): void {
    if (this.runningTasks.has(taskId)) {
      this.runningTasks.delete(taskId);
      log.warn({ taskId, label }, 'Subagent timed out');
    }
  }

  getRunningCount(): number {
    return this.runningTasks.size;
  }
}
