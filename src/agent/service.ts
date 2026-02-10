// AgentService - Main agent implementation using @mariozechner/pi-agent-core
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { MessageBus, InboundMessage } from '../bus/index.js';
import type { Config, AgentDefaults } from '../config/schema.js';
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
import type { SubagentResult } from './tools/communication.js';
import { createLogger } from '../utils/logger.js';
import { ModelRegistry } from '../providers/registry.js';

const log = createLogger('AgentService');

interface AgentServiceConfig {
  workspace: string;
  model?: string;
  braveApiKey?: string;
  spawnSubagent?: (task: string, label?: string) => Promise<SubagentResult>;
  config?: Config;
  agentDefaults?: AgentDefaults;
}

export class AgentService {
  private agent: Agent;
  private memory: MemoryStore;
  private compactor: SessionCompactor;
  private unsubscribe?: () => void;
  private running = false;
  private currentContext: { channel: string; chatId: string } | null = null;

  constructor(private bus: MessageBus, private config: AgentServiceConfig) {
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
    log.info('Agent service started');

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        await this.handleInboundMessage(msg);
      } catch (error) {
        log.error({ err: error }, 'Error in agent loop');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  stop(): void {
    this.running = false;
    this.agent.abort();
    this.unsubscribe?.();
    log.info('Agent service stopped');
  }

  private async handleInboundMessage(msg: InboundMessage): Promise<void> {
    this.currentContext = {
      channel: msg.channel,
      chatId: msg.chat_id,
    };

    try {
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

    let messages = await this.memory.load(sessionKey);

    // Apply sliding window trim (save is done in load if needed)
    const windowStats = this.memory.getWindowStats(messages);
    if (windowStats.needsTrim) {
      log.debug({ sessionKey, ...windowStats }, 'Messages will be trimmed on save');
    }

    // Check and apply compaction
    const contextWindow = this.getContextWindow();
    await this.checkAndCompact(sessionKey, messages, contextWindow);

    // Reload after potential compaction
    messages = await this.memory.load(sessionKey);
    this.agent.replaceMessages(messages);

    const userMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: msg.content }],
      timestamp: Date.now(),
    };

    await this.agent.prompt(userMessage);
    await this.agent.waitForIdle();

    const finalContent = this.getLastAssistantContent();
    if (finalContent) {
      await this.bus.publishOutbound({
        channel: msg.channel,
        chat_id: msg.chat_id,
        content: finalContent,
      });
    }

    await this.memory.save(sessionKey, this.agent.state.messages);
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
