// AgentService - Main agent implementation using @mariozechner/pi-agent-core
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { MessageBus, InboundMessage } from '../bus/index.js';
import type { Config, AgentDefaults } from '../config/schema.js';
import type { PluginTool } from '../plugins/types.js';
import { getApiKey as getConfigApiKey } from '../config/schema.js';
import { MemoryStore, type CompactionConfig, type WindowConfig } from './memory/store.js';
import { SessionCompactor } from './memory/compaction.js';
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  createShellTool,
  createWebSearchTool,
  webFetchTool,
  createMessageTool,
  createSpawnTool,
} from './tools/index.js';
import { loadSkills } from './skills.js';
import type { SubagentResult } from './tools/communication.js';
import { createLogger } from '../utils/logger.js';
import { ModelRegistry } from '../providers/registry.js';
import { PluginRegistry, HookRunner, createHookContext } from '../plugins/index.js';

const log = createLogger('AgentService');

interface AgentServiceConfig {
  workspace: string;
  model?: string;
  braveApiKey?: string;
  spawnSubagent?: (task: string, label?: string) => Promise<SubagentResult>;
  config?: Config;
  agentDefaults?: AgentDefaults;
  pluginRegistry?: PluginRegistry;
}

export class AgentService {
  private agent: Agent;
  private memory: MemoryStore;
  private compactor: SessionCompactor;
  private hookRunner?: HookRunner;
  private unsubscribe?: () => void;
  private running = false;
  private currentContext: { channel: string; chatId: string; sessionKey: string } | null = null;
  private agentId: string;

  constructor(private bus: MessageBus, private config: AgentServiceConfig) {
    this.agentId = `agent-${Date.now()}`;
    const defaults = config.agentDefaults || config.config?.agents?.defaults;
    
    // Initialize memory store with configs
    const windowConfig: Partial<WindowConfig> = {
      maxMessages: 100,
      keepRecentMessages: defaults?.maxToolIterations || 20,
      preserveSystemMessages: true,
    };
    
    const compactionConfig: Partial<CompactionConfig> = {
      enabled: defaults?.compaction?.enabled ?? true,
      mode: defaults?.compaction?.mode || 'default',
      reserveTokens: defaults?.compaction?.reserveTokens || 8000,
      triggerThreshold: defaults?.compaction?.triggerThreshold || 0.8,
      minMessagesBeforeCompact: defaults?.compaction?.minMessagesBeforeCompact || 10,
      keepRecentMessages: defaults?.compaction?.keepRecentMessages || 10,
    };
    
    this.memory = new MemoryStore(config.workspace, windowConfig, compactionConfig);
    this.compactor = new SessionCompactor(compactionConfig);

    // Initialize hook runner if plugin registry provided
    if (config.pluginRegistry) {
      this.hookRunner = new HookRunner(config.pluginRegistry, {
        catchErrors: true,
        logger: {
          info: (msg) => log.info({ hook: true }, msg),
          warn: (msg) => log.warn({ hook: true }, msg),
          error: (msg) => log.error({ hook: true }, msg),
        },
      });
    }

    // Initialize agent with tools
    const tools: AgentTool<any, any>[] = [
      readFileTool,
      writeFileTool,
      editFileTool,
      listDirTool,
      createShellTool(config.workspace),
      createWebSearchTool(config.braveApiKey),
      webFetchTool,
      createMessageTool(bus, () => this.currentContext),
    ];

    if (config.spawnSubagent) {
      tools.push(createSpawnTool(config.spawnSubagent));
    }

    // Add plugin tools from registry
    if (config.pluginRegistry) {
      const pluginTools = this.convertPluginTools(config.pluginRegistry.getAllTools());
      tools.push(...pluginTools);
      log.info({ count: pluginTools.length }, 'Loaded plugin tools');
    }

    // Load skills as tools
    const skillTools = loadSkills({ workspaceDir: config.workspace });
    if (skillTools.length > 0) {
      tools.push(...skillTools);
      log.info({ count: skillTools.length }, 'Loaded skills as tools');
    }

    const registry = new ModelRegistry(config.config ?? null, { ollamaEnabled: false });
    let model: Model<Api>;
    
    if (config.model) {
      const found = registry.findByRef(config.model);
      if (found) {
        model = found;
      } else {
        log.warn({ model: config.model }, 'Model not found, using default');
        model = registry.find('google', 'gemini-2.5-flash-lite-preview-06-17')!;
      }
    } else {
      model = registry.find('google', 'gemini-2.5-flash-lite-preview-06-17')!;
    }

    this.agent = new Agent({
      initialState: {
        systemPrompt: this.getSystemPrompt(),
        model,
        tools,
        messages: [],
      },
      getApiKey: (provider: string) => {
        if (config.config) {
          return getConfigApiKey(config.config, provider) ?? undefined;
        }
        return undefined;
      },
    });

    this.unsubscribe = this.agent.subscribe((event) => this.handleEvent(event));
  }

  async start(): Promise<void> {
    this.running = true;
    
    // Trigger gateway_start hook
    await this.triggerHook('gateway_start', { port: 0, host: 'cli' });
    
    log.info('Agent service started');

    // Trigger session_start hook
    await this.triggerHook('session_start', { sessionId: this.agentId });

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        await this.handleInboundMessage(msg);
      } catch (error) {
        log.error({ err: error }, 'Error in agent loop');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Trigger session_end hook
    await this.triggerHook('session_end', { 
      sessionId: this.agentId,
      messageCount: this.agent.state.messages.length,
    });
  }

  stop(): Promise<void> {
    this.running = false;
    this.agent.abort();
    this.unsubscribe?.();
    
    // Trigger gateway_stop hook
    this.triggerHook('gateway_stop', { reason: 'stopped' });
    
    log.info('Agent service stopped');
    return Promise.resolve();
  }

  /**
   * Trigger a hook event
   */
  private async triggerHook(event: string, eventData: Record<string, unknown>): Promise<void> {
    if (!this.hookRunner) return;
    
    const ctx = createHookContext({
      pluginId: undefined,
      sessionKey: this.currentContext?.sessionKey,
      agentId: this.agentId,
      timestamp: new Date(),
    });
    
    try {
      await this.hookRunner.runHooks(event as any, eventData, ctx);
    } catch (error) {
      log.warn({ event, err: error }, 'Hook execution failed');
    }
  }

  /**
   * Convert plugin tools to AgentTool format
   */
  private convertPluginTools(pluginTools: PluginTool[]): AgentTool<any, any>[] {
    return pluginTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      label: `🔌 ${tool.name}`,

      async execute(
        toolCallId: string,
        params: Record<string, unknown>,
        _signal?: AbortSignal
      ): Promise<AgentToolResult<{}>> {
        try {
          const result = await tool.execute(params);
          return {
            content: [{ type: 'text', text: result }],
            details: {},
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error executing tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            details: {},
          };
        }
      },
    }));
  }

  private async handleInboundMessage(msg: InboundMessage): Promise<void> {
    const sessionKey = `${msg.channel}:${msg.chat_id}`;
    
    this.currentContext = {
      channel: msg.channel,
      chatId: msg.chat_id,
      sessionKey,
    };

    try {
      // Trigger message_received hook
      await this.triggerHook('message_received', {
        channelId: msg.channel,
        from: msg.sender_id,
        content: msg.content,
        timestamp: new Date(),
      });

      if (msg.channel === 'system') {
        await this.handleSystemMessage(msg);
      } else {
        await this.handleUserMessage(msg);
      }
    } finally {
      this.currentContext = null;
    }
  }

  private async handleUserMessage(msg: InboundMessage): Promise<void> {
    const sessionKey = `${msg.channel}:${msg.chat_id}`;
    log.info({ channel: msg.channel, senderId: msg.sender_id }, 'Processing message');

    // Trigger before_agent_start hook
    await this.triggerHook('before_agent_start', {
      prompt: msg.content,
    });

    let messages = await this.memory.load(sessionKey);

    // Apply sliding window trim
    const windowStats = this.memory.getWindowStats(messages);
    if (windowStats.needsTrim) {
      log.debug({ sessionKey, ...windowStats }, 'Messages will be trimmed on save');
    }

    // Check and apply compaction
    const contextWindow = this.getContextWindow();
    
    // Trigger before_compaction hook
    await this.triggerHook('before_compaction', {
      messageCount: messages.length,
      tokenCount: await this.memory.estimateTokenUsage(sessionKey, messages),
    });

    await this.checkAndCompact(sessionKey, messages, contextWindow);

    // Reload after potential compaction
    messages = await this.memory.load(sessionKey);
    this.agent.replaceMessages(messages);

    const userMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: msg.content }],
      timestamp: Date.now(),
    };

    // Trigger before_tool_call for any tools that will be executed
    await this.triggerHook('before_tool_call', {
      toolName: 'user_message',
      params: { content: msg.content },
    });

    await this.agent.prompt(userMessage);
    await this.agent.waitForIdle();

    const finalContent = this.getLastAssistantContent();
    if (finalContent) {
      // Trigger message_sending hook
      const sendResult = await this.runMessageSendingHook(msg.chat_id, finalContent);
      
      if (!sendResult.send) {
        log.debug({ reason: sendResult.reason }, 'Message sending cancelled by hook');
      } else {
        await this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          content: sendResult.content || finalContent,
        });

        // Trigger message_sent hook
        await this.triggerHook('message_sent', {
          to: msg.chat_id,
          content: sendResult.content || finalContent,
          success: true,
        });
      }
    }

    await this.memory.save(sessionKey, this.agent.state.messages);

    // Trigger agent_end hook
    await this.triggerHook('agent_end', {
      messages: this.agent.state.messages,
      success: true,
      durationMs: 0,
    });
  }

  private async handleSystemMessage(msg: InboundMessage): Promise<void> {
    log.info({ senderId: msg.sender_id }, 'Processing system message');

    let originChannel = 'cli';
    let originChatId = msg.chat_id;
    if (msg.chat_id.includes(':')) {
      const [ch, ...rest] = msg.chat_id.split(':');
      originChannel = ch;
      originChatId = rest.join(':');
    }

    const sessionKey = `${originChannel}:${originChatId}`;
    let messages = await this.memory.load(sessionKey);

    // Apply sliding window
    const windowStats = this.memory.getWindowStats(messages);
    if (windowStats.needsTrim) {
      messages = await this.memory.load(sessionKey);
    }

    // Check compaction
    const contextWindow = this.getContextWindow();
    await this.checkAndCompact(sessionKey, messages, contextWindow);

    messages = await this.memory.load(sessionKey);
    this.agent.replaceMessages(messages);

    const systemMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[System: ${msg.sender_id}] ${msg.content}` }],
      timestamp: Date.now(),
    };

    await this.agent.prompt(systemMessage);
    await this.agent.waitForIdle();

    const finalContent = this.getLastAssistantContent();
    if (finalContent) {
      await this.bus.publishOutbound({
        channel: originChannel,
        chat_id: originChatId,
        content: finalContent,
      });
    }

    await this.memory.save(sessionKey, this.agent.state.messages);
  }

  /**
   * Run message_sending hooks and get result
   */
  private async runMessageSendingHook(
    to: string,
    content: string
  ): Promise<{ send: boolean; content?: string; reason?: string }> {
    if (!this.hookRunner) {
      return { send: true, content };
    }

    const ctx = createHookContext({
      sessionKey: this.currentContext?.sessionKey,
      agentId: this.agentId,
      timestamp: new Date(),
    });

    try {
      const result = await this.hookRunner.runHooks('message_sending' as any, { to, content }, ctx);
      
      // Check if any hook cancelled
      for (const r of result.results) {
        const typed = r as { result?: Record<string, unknown> };
        if (typed.result) {
          const resultObj = typed.result;
          if (resultObj.cancel === true) {
            return { send: false, reason: resultObj.cancelReason as string | undefined, content: resultObj.content as string | undefined };
          }
          if (typeof resultObj.content === 'string') {
            content = resultObj.content;
          }
        }
      }
      
      return { send: true, content };
    } catch (error) {
      log.warn({ err: error }, 'message_sending hook failed');
      return { send: true, content };
    }
  }

  /**
   * Check if session needs compaction and apply if needed
   */
  private async checkAndCompact(
    sessionKey: string,
    messages: AgentMessage[],
    contextWindow: number
  ): Promise<void> {
    const prep = this.memory.prepareCompaction(sessionKey, messages, contextWindow);
    
    if (!prep.needsCompaction) {
      return;
    }

    log.info({ 
      sessionKey, 
      reason: prep.stats?.reason,
      usagePercent: prep.stats?.usagePercent 
    }, 'Session needs compaction');

    try {
      const result = await this.memory.compact(sessionKey, messages, contextWindow);
      
      // Trigger after_compaction hook
      await this.triggerHook('after_compaction', {
        messageCount: messages.length,
        tokenCount: result.tokensBefore,
        compactedCount: messages.length - result.firstKeptIndex,
      });

      log.info({
        sessionKey,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        savedTokens: result.tokensBefore - result.tokensAfter,
      }, 'Session compacted');
    } catch (error) {
      log.error({ err: error, sessionKey }, 'Failed to compact session');
    }
  }

  /**
   * Get model context window
   */
  private getContextWindow(): number {
    const defaults = this.config.agentDefaults || this.config.config?.agents?.defaults;
    return defaults?.maxTokens ? defaults.maxTokens * 4 : 128000;
  }

  /**
   * Manual compaction command
   */
  async compactSession(sessionKey: string, instructions?: string): Promise<void> {
    const messages = await this.memory.load(sessionKey);
    const contextWindow = this.getContextWindow();
    
    const result = await this.memory.compact(sessionKey, messages, contextWindow, instructions);
    
    if (result.compacted) {
      await this.memory.save(sessionKey, await this.memory.load(sessionKey));
    }
    
    log.info({ sessionKey, result }, 'Manual compaction complete');
  }

  /**
   * Get session stats
   */
  getSessionStats(sessionKey: string, messages: AgentMessage[]) {
    return {
      windowStats: this.memory.getWindowStats(messages),
      compactionStats: this.memory.getCompactionStats(sessionKey),
      tokenEstimate: this.memory.estimateTokenUsage(sessionKey, messages),
    };
  }

  private handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        log.debug('Agent turn started');
        break;
      case 'turn_start':
        log.debug('Turn started');
        break;
      case 'message_start':
        if (event.message.role === 'assistant') {
          log.debug('Assistant response starting');
        }
        break;
      case 'message_end':
        if (event.message.role === 'assistant') {
          const text = this.extractTextContent(event.message.content);
          log.debug({ contentLength: text.length }, 'Assistant response complete');
        }
        break;
      case 'tool_execution_start':
        log.debug({ tool: event.toolName }, 'Tool execution started');
        break;
      case 'tool_execution_end':
        log.debug(
          { tool: event.toolName, isError: event.isError },
          'Tool execution complete'
        );
        break;
      case 'turn_end':
        log.debug('Turn complete');
        break;
      case 'agent_end':
        log.debug('Agent turn ended');
        break;
    }
  }

  private getLastAssistantContent(): string | null {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        return this.extractTextContent(msg.content);
      }
    }
    return null;
  }

  private extractTextContent(
    content: Array<{ type: string; text?: string }>
  ): string {
    return content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('');
  }

  private getSystemPrompt(): string {
    return `You are xopcbot, an AI assistant that helps users with various tasks.

You have access to tools for:
- File operations (read, write, edit, list)
- Shell command execution
- Web search and fetching
- Sending messages
- Spawning background sub-agents

Guidelines:
1. Use tools proactively to complete tasks
2. Confirm destructive operations with the user
3. Keep responses concise unless detailed explanation is needed
4. When editing files, ensure the oldText matches exactly
5. Use web search for current information

Current working directory is set automatically for shell commands.`;
  }

  async processDirect(content: string, sessionKey = 'cli:direct'): Promise<string> {
    const messages = await this.memory.load(sessionKey);
    this.agent.replaceMessages(messages);

    await this.agent.prompt({
      role: 'user',
      content: [{ type: 'text', text: content }],
      timestamp: Date.now(),
    });
    await this.agent.waitForIdle();

    const response = this.getLastAssistantContent() || '';
    await this.memory.save(sessionKey, this.agent.state.messages);

    return response;
  }
}
