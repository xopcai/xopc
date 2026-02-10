// AgentService - Main agent implementation using @mariozechner/pi-agent-core
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { MessageBus, InboundMessage, OutboundMessage } from '../bus/index.js';
import type { Config } from '../config/schema.js';
import { MemoryStore } from './memory/store.js';
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
  config?: Config;  // Full config for provider/model registration
}

export class AgentService {
  private agent: Agent;
  private memory: MemoryStore;
  private unsubscribe?: () => void;
  private running = false;
  private currentContext: { channel: string; chatId: string } | null = null;
  private pendingOutbound: string[] = [];

  constructor(private bus: MessageBus, private config: AgentServiceConfig) {
    this.memory = new MemoryStore(config.workspace);

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

    // Add spawn tool if handler provided
    if (config.spawnSubagent) {
      tools.push(createSpawnTool(config.spawnSubagent));
    }

    // Resolve model using registry (pass config for custom models)
    const registry = new ModelRegistry(config.config ?? null, { ollamaEnabled: false });
    let model: Model<Api>;
    
    if (config.model) {
      const found = registry.findByRef(config.model);
      if (found) {
        model = found;
      } else {
        // Fallback to gemini flash lite
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
    });

    // Subscribe to agent events
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
    // Set context for tools
    this.currentContext = {
      channel: msg.channel,
      chatId: msg.chat_id,
    };

    // Clear pending outbound
    this.pendingOutbound = [];

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

    // Load session history
    const history = await this.memory.load(sessionKey);
    this.agent.replaceMessages(history);

    // Send prompt
    const userMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: msg.content }],
      timestamp: Date.now(),
    };

    await this.agent.prompt(userMessage);
    await this.agent.waitForIdle();

    // Send final response if any content was generated
    const finalContent = this.getLastAssistantContent();
    if (finalContent) {
      await this.bus.publishOutbound({
        channel: msg.channel,
        chat_id: msg.chat_id,
        content: finalContent,
      });
    }

    // Save session
    await this.memory.save(sessionKey, this.agent.state.messages);
  }

  private async handleSystemMessage(msg: InboundMessage): Promise<void> {
    log.info({ senderId: msg.sender_id }, 'Processing system message');

    // Parse origin from chat_id (format: "channel:chatId")
    let originChannel = 'cli';
    let originChatId = msg.chat_id;
    if (msg.chat_id.includes(':')) {
      const [ch, ...rest] = msg.chat_id.split(':');
      originChannel = ch;
      originChatId = rest.join(':');
    }

    const sessionKey = `${originChannel}:${originChatId}`;

    // Load session
    const history = await this.memory.load(sessionKey);
    this.agent.replaceMessages(history);

    // Send system prompt as user message with prefix
    const systemMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[System: ${msg.sender_id}] ${msg.content}` }],
      timestamp: Date.now(),
    };

    await this.agent.prompt(systemMessage);
    await this.agent.waitForIdle();

    // Send response
    const finalContent = this.getLastAssistantContent();
    if (finalContent) {
      await this.bus.publishOutbound({
        channel: originChannel,
        chat_id: originChatId,
        content: finalContent,
      });
    }

    // Save session
    await this.memory.save(sessionKey, this.agent.state.messages);
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

      case 'message_update':
        // Stream updates - could be used for real-time UI updates
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
    content: Array<{ type: string; text?: string }
  >): string {
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

  // Direct processing method for CLI/non-bus usage
  async processDirect(content: string, sessionKey = 'cli:direct'): Promise<string> {
    // Load session
    const history = await this.memory.load(sessionKey);
    this.agent.replaceMessages(history);

    // Send prompt
    await this.agent.prompt({
      role: 'user',
      content: [{ type: 'text', text: content }],
      timestamp: Date.now(),
    });
    await this.agent.waitForIdle();

    // Get response
    const response = this.getLastAssistantContent() || '';

    // Save session
    await this.memory.save(sessionKey, this.agent.state.messages);

    return response;
  }
}
