import { XopcAgentConfig, XopcChatModel, XopcChatAgent, XopcQueuedInput, XopcSessionPreparation, XopcQueueState, XopcQueueUpdate } from '../model/chat';
import { XopcLocalSession } from '../model/sessionCommand';
import { XopcChatRepository } from '../repository/chatRepository';

@ObservedV2
export class XopcChatOptionsViewModel {
  @Trace preparation?: XopcSessionPreparation;
  @Trace models: XopcChatModel[] = [];
  @Trace agents: XopcChatAgent[] = [];
  @Trace modelId: string = '';
  @Trace agentId: string = '';
  @Trace queued: XopcQueuedInput[] = [];
  @Trace loading: boolean = false;
  @Trace saving: boolean = false;
  @Trace queueBusy: boolean = false;
  @Trace error: string = '';
  @Trace queueError: string = '';
  private repository: XopcChatRepository = new XopcChatRepository();
  private conversationId: string = '';
  private generation: number = 0;
  private queueRequest: number = 0;
  private timer: number = -1;
  @Trace thinkingLevel: string = 'off';

  dispose(): void { this.generation++; this.queueRequest++; clearInterval(this.timer); this.timer = -1; }
  pause(): void { this.queueRequest++; clearInterval(this.timer); this.timer = -1; }
  resume(): void {
    if (!this.conversationId || this.timer !== -1) return;
    this.refreshQueue(); this.timer = setInterval((): void => { this.refreshQueue(); }, 15000);
  }
  async load(id: string, agentId: string = ''): Promise<void> {
    this.pause(); const generation = ++this.generation;
    this.queueRequest++; this.conversationId = id; this.agentId = agentId; this.queued = [];
    this.models = []; this.agents = []; this.modelId = ''; this.thinkingLevel = 'off'; this.error = ''; this.loading = true;
    this.resume();
    try {
      // Freeze draft identity before slower catalog requests. The first input may
      // materialize the draft while those requests are in flight.
      const draft: XopcLocalSession | undefined = await this.repository.draft(id);
      if (generation !== this.generation) return;
      const agents = await this.repository.agents();
      if (generation !== this.generation) return;
      this.agents = agents.agents; this.agentId = agentId || agents.defaultId;
      const models = await this.repository.models(this.agentId);
      if (generation !== this.generation) return;
      this.models = models.models ?? models.items ?? [];
      const config: XopcAgentConfig = draft ? { model: draft.creation.model, thinkingLevel: draft.creation.thinkingLevel }
        : await this.repository.config(id);
      if (generation !== this.generation) return;
      this.modelId = config.model || models.defaultId || this.models[0]?.id || '';
      const currentModel = this.models.find((item: XopcChatModel): boolean => item.id === this.modelId);
      this.thinkingLevel = this.supportedThinking(currentModel, config.thinkingLevel);
      if (!config.model && this.modelId && draft) {
        const selected = this.models.find((item: XopcChatModel): boolean => item.id === this.modelId);
        this.thinkingLevel = selected?.thinking?.initialValue ?? 'off';
        await this.repository.setModel(id, this.modelId, this.thinkingLevel);
      }
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  modelName(language: string): string {
    const model = this.models.find((item: XopcChatModel): boolean => item.id === this.modelId);
    return model?.displayNames?.[language.startsWith('zh') ? 'zh-CN' : 'en'] || model?.name || this.modelId.split('/').pop() || 'xopc';
  }
  selectedModel(): XopcChatModel | undefined { return this.models.find((item: XopcChatModel): boolean => item.id === this.modelId); }
  private supportedThinking(model: XopcChatModel | undefined, level?: string): string {
    if (!model?.thinking) return level || 'off';
    return model.thinking.options.includes(level || '') ? level || 'off' : model.thinking.initialValue;
  }
  agentName(): string { return this.agents.find((item: XopcChatAgent): boolean => item.id === this.agentId)?.name || this.agentId; }
  async selectModel(id: string): Promise<boolean> {
    if (this.loading || this.saving || !this.conversationId || !this.models.some((item: XopcChatModel): boolean => item.id === id)) return false;
    const model = this.models.find((item: XopcChatModel): boolean => item.id === id);
    const level = this.supportedThinking(model, this.thinkingLevel);
    this.saving = true; this.error = ''; const generation = ++this.generation;
    try {
      await this.repository.setModel(this.conversationId, id, level);
      if (generation !== this.generation) return false;
      this.modelId = id; this.thinkingLevel = level;
      await this.repository.rememberModel(this.agentId, id, level);
      return generation === this.generation;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return false; }
    finally { this.saving = false; }
  }
  async selectThinking(level: string): Promise<boolean> {
    const model = this.selectedModel();
    if (this.loading || this.saving || !this.conversationId || !model?.thinking?.options.includes(level)
      || (model.thinking.mode !== 'levels' && model.thinking.mode !== 'toggle')) return false;
    if (level === this.thinkingLevel) return true;
    this.saving = true; this.error = ''; const generation = ++this.generation;
    try {
      await this.repository.setModel(this.conversationId, this.modelId, level);
      if (generation !== this.generation) return false;
      this.thinkingLevel = level;
      await this.repository.rememberModel(this.agentId, this.modelId, level);
      return generation === this.generation;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return false; }
    finally { this.saving = false; }
  }
  async refreshQueue(): Promise<void> {
    const id = this.conversationId; if (!id) return;
    const request = ++this.queueRequest;
    try {
      const state = await this.repository.queue(id);
      if (request !== this.queueRequest) return;
      this.applyQueue(state);
    } catch (error) { if (request === this.queueRequest) this.queueError = (error as Error).message; }
  }
  private applyQueue(state: XopcQueueState): void {
    const queued = state.inputs.filter((item: XopcQueuedInput): boolean => item.kind === 'message' && item.status === 'queued')
      .sort((a: XopcQueuedInput, b: XopcQueuedInput): number => a.position - b.position);
    // The first unclaimed input is the pending turn, not a follow-up.
    this.queued = !state.activeRunId && state.preparation?.state !== 'preparation_failed' ? queued.slice(1) : queued;
    this.preparation = state.preparation;
    this.queueError = state.preparation?.state === 'preparation_failed' ? state.preparation.lastError || 'SESSION_PREPARATION_FAILED' : '';
  }
  async updateQueued(input: XopcQueuedInput, update: XopcQueueUpdate): Promise<boolean> {
    if (this.queueBusy) return false;
    const hasPayload = !!update.content?.trim() || !!update.attachments?.length || !!update.contextRefs?.length;
    if (update.position === undefined && !hasPayload) return false;
    this.queueBusy = true; const id = this.conversationId; const generation = this.generation; this.queueRequest++;
    try {
      const state = await this.repository.updateQueued(id, input, update);
      if (generation !== this.generation) return false;
      this.applyQueue(state); return true;
    } catch (error) { if (generation === this.generation) { await this.refreshQueue(); this.queueError = (error as Error).message; } return false; }
    finally { this.queueBusy = false; }
  }
  async cancelQueued(input: XopcQueuedInput): Promise<void> {
    if (this.queueBusy) return;
    this.queueBusy = true; const generation = this.generation; this.queueRequest++;
    try { const state = await this.repository.cancelQueued(this.conversationId, input); if (generation === this.generation) this.applyQueue(state); }
    catch (error) { if (generation === this.generation) { await this.refreshQueue(); this.queueError = (error as Error).message; } }
    finally { this.queueBusy = false; }
  }
  async retryQueue(): Promise<void> {
    if (this.queueBusy) return;
    this.queueBusy = true;
    try {
      if (this.preparation?.state === 'preparation_failed') {
        await this.repository.retryPreparation(this.conversationId, this.preparation.operationId, this.preparation.revision);
      }
      await this.refreshQueue();
    } catch (error) { this.queueError = (error as Error).message; }
    finally { this.queueBusy = false; }
  }
}
