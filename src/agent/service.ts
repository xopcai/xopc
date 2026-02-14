import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { MessageBus, InboundMessage } from '../bus/index.js';
import type { Config, AgentDefaults } from '../config/schema.js';
import type { PluginTool } from '../plugins/types.js';
import { getApiKey as getConfigApiKey } from '../config/schema.js';
import { SessionStore, type CompactionConfig, type WindowConfig } from '../session/index.js';
import { SessionCompactor } from './memory/compaction.js';
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  createShellTool,
  grepTool,
  findTool,
  createWebSearchTool,
  webFetchTool,
  createMessageTool,
  createMemorySearchTool,
  createMemoryGetTool,
} from './tools/index.js';
import { createSkillLoader, type Skill } from './skills/index.js';
import { getBundledSkillsDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { ModelRegistry } from '../providers/registry.js';
import { PluginRegistry, HookRunner, createHookContext } from '../plugins/index.js';
import { isFailoverError, describeFailoverError, resolveFallbackCandidates } from './fallback/index.js';
import { PromptBuilder } from './prompt/index.js';
import { createTypingController } from './typing.js';

const log = createLogger('AgentService');

const BOOTSTRAP_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'AGENTS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
];

/** Maximum characters to inject from workspace files into system prompt */
const BOOTSTRAP_MAX_CHARS = 20_000;

/**
 * Strip YAML front matter from markdown content.
 * Removes the ---
 * key: value
 * --- header if present.
 */
function stripFrontMatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return content;
  }
  return content.slice(endIndex + 4).replace(/^\s+/, '');
}

interface TruncateResult {
  content: string;
  truncated: boolean;
  originalLength: number;
}

/**
 * Truncate workspace file content to prevent token overflow.
 * Keeps head (70%) and tail (20%) with a truncation marker in between.
 */
function truncateBootstrapContent(content: string, maxChars: number): TruncateResult {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return {
      content: trimmed,
      truncated: false,
      originalLength: trimmed.length,
    };
  }

  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.2);
  const head = trimmed.slice(0, headChars);
  const tail = trimmed.slice(-tailChars);

  const marker = [
    '',
    '[...content truncated, read the full file for complete content...]',
    `...(truncated: kept ${headChars}+${tailChars} chars of ${trimmed.length})...`,
    '',
  ].join('\n');

  return {
    content: head + marker + tail,
    truncated: true,
    originalLength: trimmed.length,
  };
}

interface AgentServiceConfig {
  workspace: string;
  model?: string;
  braveApiKey?: string;
  config?: Config;
  agentDefaults?: AgentDefaults;
  pluginRegistry?: PluginRegistry;
}

export class AgentService {
  private agent: Agent;
  private sessionStore: SessionStore;
  private compactor: SessionCompactor;
  private hookRunner?: HookRunner;
  private unsubscribe?: () => void;
  private running = false;
  private currentContext: { channel: string; chatId: string; sessionKey: string } | null = null;
  private agentId: string;
  private skillPrompt: string = '';
  private skills: Skill[] = [];
  private skillLoader = createSkillLoader();
  private currentModelName: string = 'minimax/MiniMax-M2.1';
  private currentProvider: string = 'google';
  private workspaceDir: string;
  private bootstrapFiles: Array<{ name: string; content: string; missing?: boolean }> = [];
  private modelRegistry: ModelRegistry;

  constructor(private bus: MessageBus, private config: AgentServiceConfig) {
    this.agentId = `agent-${Date.now()}`;
    this.workspaceDir = config.workspace;

    this.loadBootstrapFiles(config.workspace);

    const defaults = config.agentDefaults || config.config?.agents?.defaults;

    const windowConfig: Partial<WindowConfig> = {
      maxMessages: 100,
      keepRecentMessages: defaults?.maxToolIterations || 20,
      preserveSystemMessages: true,
    };

    const compactionConfig: Partial<CompactionConfig> = {
      enabled: defaults?.compaction?.enabled ?? true,
      mode: (defaults?.compaction?.mode as 'extractive' | 'abstractive' | 'structured') || 'abstractive',
      reserveTokens: defaults?.compaction?.reserveTokens || 8000,
      triggerThreshold: defaults?.compaction?.triggerThreshold || 0.8,
      minMessagesBeforeCompact: defaults?.compaction?.minMessagesBeforeCompact || 10,
      keepRecentMessages: defaults?.compaction?.keepRecentMessages || 10,
    };

    this.sessionStore = new SessionStore(config.workspace, windowConfig, compactionConfig);

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

    const tools: AgentTool<any, any>[] = [
      readFileTool,
      writeFileTool,
      editFileTool,
      listDirTool,
      grepTool,
      findTool,
      createShellTool(config.workspace),
      createWebSearchTool(config.braveApiKey),
      webFetchTool,
      createMessageTool(bus, () => this.currentContext),
      createMemorySearchTool(config.workspace),
      createMemoryGetTool(config.workspace),
    ];

    if (config.pluginRegistry) {
      const pluginTools = this.convertPluginTools(config.pluginRegistry.getAllTools());
      tools.push(...pluginTools);
      log.info({ count: pluginTools.length }, 'Loaded plugin tools');
    }

    const skillResult = this.skillLoader.init(config.workspace, getBundledSkillsDir());
    this.skillPrompt = skillResult.prompt;
    this.skills = skillResult.skills;

    for (const diag of skillResult.diagnostics) {
      if (diag.type === 'collision') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill collision');
      } else if (diag.type === 'warning') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill warning');
      }
    }

    log.info({ count: skillResult.skills.length }, 'Skills loaded');

    const registry = new ModelRegistry(config.config ?? null, { ollamaEnabled: false });
    this.modelRegistry = registry;
    let model: Model<Api>;

    if (config.model) {
      const found = registry.findByRef(config.model);
      if (found) {
        model = found;
        this.currentModelName = found.id || config.model;
        this.currentProvider = found.provider || 'google';
      } else {
        log.warn({ model: config.model }, 'Model not found, using default');
        model = registry.find('google', 'gemini-2.5-flash-lite-preview-06-17')!;
        this.currentModelName = model.id || 'gemini-2.5-flash-lite';
        this.currentProvider = 'google';
      }
    } else {
      model = registry.find('google', 'gemini-2.5-flash-lite-preview-06-17')!;
      this.currentModelName = model.id || 'gemini-2.5-flash-lite';
      this.currentProvider = 'google';
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

    await this.triggerHook('gateway_start', { port: 0, host: 'cli' });
    log.info('Agent service started');

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

    await this.triggerHook('session_end', {
      sessionId: this.agentId,
      messageCount: this.agent.state.messages.length,
    });
  }

  stop(): Promise<void> {
    this.running = false;
    this.agent.abort();
    this.unsubscribe?.();

    this.triggerHook('gateway_stop', { reason: 'stopped' });

    log.info('Agent service stopped');
    return Promise.resolve();
  }

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

    const typing = createTypingController({
      onStart: async () => {
        await this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          type: 'typing_on',
        });
      },
      onStop: async () => {
        await this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          type: 'typing_off',
        });
      },
    });

    try {
      typing.start();

      const command = msg.content.trim();
      if (command === '/reset' || command === '/new') {
        await this.sessionStore.deleteSession(sessionKey);
        await this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          content: '✅ New session started.',
          type: 'message',
        });
        return;
      }

      if (command === '/skills reload') {
        this.reloadSkills();
        await this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          content: '✅ Skills reloaded successfully',
          type: 'message',
        });
        return;
      }

      const expandedContent = this.expandSkillCommand(msg.content);

      await this.triggerHook('before_agent_start', {
        prompt: expandedContent,
      });

      let messages = await this.sessionStore.load(sessionKey);

      const windowStats = this.sessionStore.getWindowStats(messages);
      if (windowStats.needsTrim) {
        log.debug({ sessionKey, ...windowStats }, 'Messages will be trimmed on save');
      }

      const contextWindow = this.getContextWindow();

      await this.triggerHook('before_compaction', {
        messageCount: messages.length,
        tokenCount: await this.sessionStore.estimateTokenUsage(sessionKey, messages),
      });

      await this.checkAndCompact(sessionKey, messages, contextWindow);

      messages = await this.sessionStore.load(sessionKey);
      this.agent.replaceMessages(messages);

      const userMessage: AgentMessage = {
        role: 'user',
        content: [{ type: 'text', text: expandedContent }],
        timestamp: Date.now(),
      };

      await this.triggerHook('before_tool_call', {
        toolName: 'user_message',
        params: { content: expandedContent },
      });

      // Run agent with model fallback support
      const finalContent = await this.runWithModelFallback(
        sessionKey,
        userMessage,
        this.currentProvider,
        this.currentModelName
      );
      if (finalContent) {
        const sendResult = await this.runMessageSendingHook(msg.chat_id, finalContent);

        if (!sendResult.send) {
          log.debug({ reason: sendResult.reason }, 'Message sending cancelled by hook');
        } else {
          await this.bus.publishOutbound({
            channel: msg.channel,
            chat_id: msg.chat_id,
            content: sendResult.content || finalContent,
            type: 'message',
          });

          await this.triggerHook('message_sent', {
            to: msg.chat_id,
            content: sendResult.content || finalContent,
            success: true,
          });
        }
      }

      await this.sessionStore.save(sessionKey, this.agent.state.messages);

      await this.triggerHook('agent_end', {
        messages: this.agent.state.messages,
        success: true,
        durationMs: 0,
      });
    } finally {
      typing.stop();
    }
  }

  /**
   * Run the agent with automatic model fallback on failure.
   */
  private async runWithModelFallback(
    sessionKey: string,
    userMessage: AgentMessage,
    provider: string,
    model: string
  ): Promise<string | null> {
    const candidates = resolveFallbackCandidates({
      cfg: this.config.config ?? undefined,
      provider,
      model,
    });

    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const candidateModel = this.modelRegistry.find(candidate.provider, candidate.model);

      if (!candidateModel) {
        log.warn(
          { provider: candidate.provider, model: candidate.model },
          'Fallback model not found in registry'
        );
        continue;
      }

      log.info(
        { attempt: i + 1, total: candidates.length, provider: candidate.provider, model: candidate.model },
        'Attempting model'
      );

      try {
        // Update the agent with the new model
        this.agent.setModel(candidateModel);
        this.currentProvider = candidate.provider;
        this.currentModelName = candidate.model;

        // Execute the prompt
        await this.agent.prompt(userMessage);
        await this.agent.waitForIdle();

        return this.getLastAssistantContent();
      } catch (err) {
        lastError = err;

        // Don't fallback on user abort
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }

        if (isFailoverError(err)) {
          const described = describeFailoverError(err);
          log.warn(
            { provider: candidate.provider, model: candidate.model, ...described },
            'Model call failed, trying fallback'
          );
        } else {
          log.warn(
            { provider: candidate.provider, model: candidate.model, error: err },
            'Model call failed with non-failover error'
          );
        }

        // Continue to next candidate
        continue;
      }
    }

    // All models failed
    if (lastError) {
      throw lastError;
    }

    return null;
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
    let messages = await this.sessionStore.load(sessionKey);

    const windowStats = this.sessionStore.getWindowStats(messages);
    if (windowStats.needsTrim) {
      messages = await this.sessionStore.load(sessionKey);
    }

    const contextWindow = this.getContextWindow();
    await this.checkAndCompact(sessionKey, messages, contextWindow);

    messages = await this.sessionStore.load(sessionKey);
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
        type: 'message',
      });
    }

    await this.sessionStore.save(sessionKey, this.agent.state.messages);
  }

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

  private async checkAndCompact(
    sessionKey: string,
    messages: AgentMessage[],
    contextWindow: number
  ): Promise<void> {
    const prep = this.sessionStore.prepareCompaction(sessionKey, messages, contextWindow);

    if (!prep.needsCompaction) {
      return;
    }

    log.info({
      sessionKey,
      reason: prep.stats?.reason,
      usagePercent: prep.stats?.usagePercent,
    }, 'Session needs compaction');

    try {
      const result = await this.sessionStore.compact(sessionKey, messages, contextWindow);

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

  private getContextWindow(): number {
    const defaults = this.config.agentDefaults || this.config.config?.agents?.defaults;
    return defaults?.maxTokens ? defaults.maxTokens * 4 : 128000;
  }

  async compactSession(sessionKey: string, instructions?: string): Promise<void> {
    const messages = await this.sessionStore.load(sessionKey);
    const contextWindow = this.getContextWindow();

    const result = await this.sessionStore.compact(sessionKey, messages, contextWindow, instructions);

    if (result.compacted) {
      await this.sessionStore.save(sessionKey, await this.sessionStore.load(sessionKey));
    }

    log.info({ sessionKey, result }, 'Manual compaction complete');
  }

  getSessionStats(sessionKey: string, messages: AgentMessage[]) {
    return {
      windowStats: this.sessionStore.getWindowStats(messages),
      compactionStats: this.sessionStore.getCompactionStats(sessionKey),
      tokenEstimate: this.sessionStore.estimateTokenUsage(sessionKey, messages),
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

  private loadBootstrapFiles(bootstrapDir: string): void {
    const files: Array<{ name: string; content: string; missing?: boolean }> = [];
    let loadedCount = 0;
    let missingCount = 0;

    for (const filename of BOOTSTRAP_FILES) {
      const filePath = join(bootstrapDir, filename);
      if (existsSync(filePath)) {
        try {
          let content = readFileSync(filePath, 'utf-8');
          
          // Strip YAML front matter (template metadata)
          content = stripFrontMatter(content);
          
          // Truncate if too long to prevent token overflow
          const result = truncateBootstrapContent(content, BOOTSTRAP_MAX_CHARS);
          
          if (result.content) {
            files.push({ name: filename, content: result.content });
            loadedCount++;
            
            if (result.truncated) {
              log.warn(
                { 
                  file: filename, 
                  originalLength: result.originalLength,
                  keptLength: result.content.length 
                }, 
                'Bootstrap file truncated in system prompt (too long)'
              );
            } else {
              log.debug({ file: filename, path: filePath }, 'Bootstrap file loaded');
            }
          }
        } catch (err) {
          log.warn({ file: filename, err }, 'Failed to load bootstrap file');
        }
      } else {
        // Mark file as missing - will be shown in system prompt
        files.push({ 
          name: filename, 
          content: `[MISSING] Create this file at: ${filePath}`,
          missing: true 
        });
        missingCount++;
        log.debug({ file: filename }, 'Bootstrap file missing');
      }
    }

    this.bootstrapFiles = files;
    log.info(
      { loaded: loadedCount, missing: missingCount, dir: bootstrapDir }, 
      'Workspace bootstrap files loaded'
    );
  }

  private getSystemPrompt(): string {
    const prompt = PromptBuilder.createFullPrompt(
      { workspaceDir: this.config.workspace },
      {
        heartbeatEnabled: false,
        contextFiles: this.bootstrapFiles,
      }
    );

    if (this.skillPrompt) {
      return prompt + '\n\n' + this.skillPrompt;
    }

    return prompt;
  }

  private reloadSkills(): void {
    const skillResult = this.skillLoader.reload();

    this.skillPrompt = skillResult.prompt;
    this.skills = skillResult.skills;

    for (const diag of skillResult.diagnostics) {
      if (diag.type === 'collision') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill collision');
      } else if (diag.type === 'warning') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill warning');
      }
    }

    log.info({ count: skillResult.skills.length, diagnostics: skillResult.diagnostics.length }, 'Skills reloaded');
  }

  private expandSkillCommand(text: string): string {
    if (!text.startsWith('/skill:')) return text;

    const spaceIndex = text.indexOf(' ');
    const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
    const args = spaceIndex === -1 ? undefined : text.slice(spaceIndex + 1).trim();

    const skill = this.skills.find((s) => s.name === skillName);
    if (!skill) return text;

    try {
      const rawContent = readFileSync(skill.filePath, 'utf-8');
      const body = rawContent.replace(/^---[\s\S]*?---\n*/, '');
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
      return args ? `${skillBlock}\n\n${args}` : skillBlock;
    } catch {
      return text;
    }
  }

  async processDirect(
    content: string, 
    sessionKey = 'cli:direct',
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }>
  ): Promise<string> {
    const messages = await this.memory.load(sessionKey);
    this.agent.replaceMessages(messages);

    // Build message content with text and attachments
    const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
    
    // Add text content if present
    if (content.trim()) {
      messageContent.push({ type: 'text', text: content });
    }

    // Add attachments (images as image blocks)
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.type === 'image' || att.mimeType?.startsWith('image/')) {
          // Use base64 data URL directly
          const mimeType = att.mimeType || 'image/png';
          const data = att.data || '';
          messageContent.push({ type: 'image', data, mimeType });
        } else {
          // For non-image files, include as text reference
          const fileInfo = `[File: ${att.name || 'unknown'} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
          messageContent.push({ type: 'text', text: fileInfo });
        }
      }
    }

    await this.agent.prompt({
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
    });
    await this.agent.waitForIdle();

    const response = this.getLastAssistantContent() || '';
    await this.memory.save(sessionKey, this.agent.state.messages);

    return response;
  }
}
