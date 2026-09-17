import { XopcChatModel, XopcChatAgent, XopcQueuedInput } from '../model/chat';
import { XopcChatRepository } from '../repository/chatRepository';

@ObservedV2
export class XopcChatOptionsViewModel {
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
  private thinkingLevel?: string;

  dispose(): void { this.generation++; this.queueRequest++; clearInterval(this.timer); this.timer = -1; }
  pause(): void { this.queueRequest++; clearInterval(this.timer); this.timer = -1; }
  resume(): void {
    if (!this.conversationId || this.timer !== -1) return;
    this.refreshQueue(); this.timer = setInterval((): void => { this.refreshQueue(); }, 15000);
  }
  async load(id: string, agentId: string = ''): Promise<void> {
    this.pause(); const generation = ++this.generation;
    this.queueRequest++; this.conversationId = id; this.agentId = agentId; this.queued = [];
    this.models = []; this.agents = []; this.modelId = ''; this.error = ''; this.loading = true;
    this.resume();
    try {
      const agents = await this.repository.agents();
      if (generation !== this.generation) return;
      this.agents = agents.agents; this.agentId = agentId || agents.defaultId;
      const models = await this.repository.models(this.agentId);
      if (generation !== this.generation) return;
      this.models = models.models ?? models.items ?? [];
      const config = await this.repository.config(id);
      if (generation !== this.generation) return;
      this.modelId = config.model || models.defaultId || this.models[0]?.id || '';
      this.thinkingLevel = config.thinkingLevel;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  modelName(language: string): string {
    const model = this.models.find((item: XopcChatModel): boolean => item.id === this.modelId);
    return model?.displayNames?.[language.startsWith('zh') ? 'zh-CN' : 'en'] || model?.name || this.modelId.split('/').pop() || 'xopc';
  }
  agentName(): string { return this.agents.find((item: XopcChatAgent): boolean => item.id === this.agentId)?.name || this.agentId; }
  async selectModel(id: string): Promise<boolean> {
    if (this.loading || this.saving || !this.conversationId || !this.models.some((item: XopcChatModel): boolean => item.id === id)) return false;
    this.saving = true; this.error = ''; const generation = ++this.generation;
    try {
      await this.repository.setModel(this.conversationId, id);
      if (generation !== this.generation) return false;
      this.modelId = id;
      await this.repository.rememberModel(this.agentId, id, this.thinkingLevel);
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
      this.queued = state.inputs.filter((item: XopcQueuedInput): boolean => item.kind === 'message' && item.status === 'queued')
        .sort((a: XopcQueuedInput, b: XopcQueuedInput): number => a.position - b.position);
      this.queueError = '';
    } catch (error) { if (request === this.queueRequest) this.queueError = (error as Error).message; }
  }
  async changeQueued(input: XopcQueuedInput, content?: string): Promise<boolean> {
    if (this.queueBusy || (content !== undefined && !content.trim())) return false;
    this.queueBusy = true; const id = this.conversationId; const generation = this.generation; this.queueRequest++;
    try {
      await this.repository.changeQueued(id, input, content);
      if (generation !== this.generation) return false;
      await this.refreshQueue(); return true;
    } catch (error) { if (generation === this.generation) { await this.refreshQueue(); this.queueError = (error as Error).message; } return false; }
    finally { this.queueBusy = false; }
  }
}
