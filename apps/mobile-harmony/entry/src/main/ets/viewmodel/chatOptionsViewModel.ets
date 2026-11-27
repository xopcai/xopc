import { agentDisplayName } from '../common/agentPresentation';
import { XopcAgentConfig, XopcChatModel, XopcChatAgent, XopcModelServiceTier, XopcSessionPreparation } from '../model/chat';
import { XopcLocalSession } from '../model/sessionCommand';
import { XopcProject, XopcProjectList } from '../model/workspace';
import { XopcChatRepository } from '../repository/chatRepository';
import { gatewaySession } from '../service/gatewaySession';

@ObservedV2
export class XopcChatOptionsViewModel {
  @Trace preparation?: XopcSessionPreparation;
  @Trace models: XopcChatModel[] = [];
  @Trace agents: XopcChatAgent[] = [];
  @Trace workspaceProjects: XopcProject[] = [];
  @Trace projectsLoading: boolean = false;
  @Trace modelId: string = '';
  @Trace agentId: string = '';
  @Trace defaultAgentId: string = 'main';
  @Trace loading: boolean = false;
  @Trace saving: boolean = false;
  @Trace preparationBusy: boolean = false;
  @Trace error: string = '';
  @Trace preparationError: string = '';
  private repository: XopcChatRepository = new XopcChatRepository();
  private conversationId: string = '';
  private generation: number = 0;
  private configVersion?: number;
  private preparationRequest: number = 0;
  private timer: number = -1;
  @Trace thinkingLevel: string = 'off';
  @Trace serviceTier: string = 'default';

  dispose(): void { this.generation++; this.preparationRequest++; clearInterval(this.timer); this.timer = -1; }
  pause(): void { this.preparationRequest++; clearInterval(this.timer); this.timer = -1; }
  resume(): void {
    if (!this.conversationId || this.timer !== -1) return;
    this.refreshPreparation(); this.timer = setInterval((): void => { this.refreshPreparation(); }, 15000);
  }
  async load(id: string, agentId: string = '', locale: string = ''): Promise<void> {
    this.pause(); const generation = ++this.generation;
    this.preparationRequest++; this.conversationId = id; this.agentId = agentId;
    this.preparation = undefined; this.preparationError = ''; this.preparationBusy = false;
    this.configVersion = undefined;
    this.models = []; this.agents = []; this.modelId = ''; this.thinkingLevel = 'off'; this.serviceTier = 'default'; this.error = ''; this.loading = true;
    this.resume();
    try {
      // Freeze draft identity before slower catalog requests. The first input may
      // materialize the draft while those requests are in flight.
      const draft: XopcLocalSession | undefined = await this.repository.draft(id);
      if (generation !== this.generation) return;
      const agents = await this.repository.agents(locale);
      if (generation !== this.generation) return;
      this.agents = agents.agents; this.defaultAgentId = agents.defaultId || 'main'; this.agentId = agentId || agents.defaultId;
      const models = await this.repository.models(this.agentId);
      if (generation !== this.generation) return;
      this.models = models.models ?? models.items ?? [];
      const config: XopcAgentConfig = draft
        ? { model: draft.creation.model, thinkingLevel: draft.creation.thinkingLevel, serviceTier: draft.creation.serviceTier }
        : await this.repository.config(id);
      if (generation !== this.generation) return;
      this.configVersion = config.configVersion;
      this.modelId = config.model || models.defaultId || this.models[0]?.id || '';
      const currentModel = this.models.find((item: XopcChatModel): boolean => item.id === this.modelId);
      this.thinkingLevel = this.supportedThinking(currentModel, config.thinkingLevel);
      this.serviceTier = config.serviceTier?.trim() || 'default';
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
  fastTier(): XopcModelServiceTier | undefined {
    const tiers = this.selectedModel()?.serviceTiers ?? [];
    if (!tiers.length) return undefined;
    return tiers.find((tier: XopcModelServiceTier): boolean =>
      tier.id === 'priority' || tier.id === 'fast' || tier.label.toLowerCase() === 'fast') ?? tiers[0];
  }
  isFastModeEnabled(): boolean {
    const fast = this.fastTier();
    if (!fast) return false;
    const normalized = this.serviceTier.trim();
    if (!normalized || normalized === 'default') return false;
    const tiers = this.selectedModel()?.serviceTiers ?? [];
    return normalized === fast.id || tiers.some((tier: XopcModelServiceTier): boolean => tier.id === normalized);
  }
  fastModeSubtitle(language: string): string {
    const isZh = language.startsWith('zh');
    const desc = this.fastTier()?.description ?? '';
    const match = desc.match(/(\d+(?:\.\d+)?x)\s*speed/i);
    const speed = match ? match[1] : '1.5x';
    return isZh ? speed + ' 极速 · 消耗更多额度' : speed + ' speed · More usage';
  }
  async selectServiceTier(tier: string): Promise<boolean> {
    if (this.loading || this.saving || !this.conversationId) return false;
    const normalized = tier.trim() || 'default';
    if (normalized === this.serviceTier) return true;
    const previous = this.serviceTier;
    this.serviceTier = normalized;
    this.saving = true; this.error = ''; const generation = ++this.generation;
    try {
      const config = await this.repository.setServiceTier(this.conversationId, normalized);
      if (generation !== this.generation) return false;
      if (config?.configVersion !== undefined) this.configVersion = config.configVersion;
      this.serviceTier = config?.serviceTier?.trim() || normalized;
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.serviceTier = previous;
        this.error = (error as Error).message;
      }
      return false;
    } finally { this.saving = false; }
  }
  async loadWorkspaceProjects(): Promise<void> {
    this.projectsLoading = true;
    try {
      const result = JSON.parse(await gatewaySession.request('/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc')) as XopcProjectList;
      const items = Array.isArray(result.items) ? result.items : [];
      this.workspaceProjects = items.filter((item: XopcProject): boolean =>
        item.status !== 'archived' && !!item.workspaceRoot?.trim());
    } catch (_error) {
      this.workspaceProjects = [];
    } finally {
      this.projectsLoading = false;
    }
  }
  private supportedThinking(model: XopcChatModel | undefined, level?: string): string {
    if (!model?.thinking) return level || 'off';
    return model.thinking.options.includes(level || '') ? level || 'off' : model.thinking.initialValue;
  }
  agentName(): ResourceStr {
    const agent = this.agents.find((item: XopcChatAgent): boolean => item.id === this.agentId);
    return agent ? agentDisplayName(agent) : this.agentId;
  }
  async selectModel(id: string, remember: boolean = true): Promise<boolean> {
    if (this.loading || this.saving || !this.conversationId || !this.models.some((item: XopcChatModel): boolean => item.id === id)) return false;
    const model = this.models.find((item: XopcChatModel): boolean => item.id === id);
    const level = this.supportedThinking(model, this.thinkingLevel);
    this.saving = true; this.error = ''; const generation = ++this.generation;
    try {
      const config = await this.repository.setModel(this.conversationId, id, level, this.configVersion);
      if (generation !== this.generation) return false;
      this.configVersion = config?.configVersion;
      this.modelId = config?.model ?? id; this.thinkingLevel = config?.thinkingLevel ?? level;
      if (remember) await this.repository.rememberModel(this.agentId, this.modelId, this.thinkingLevel);
      return generation === this.generation;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return false; }
    finally { this.saving = false; }
  }
  async selectThinking(level: string, remember: boolean = true): Promise<boolean> {
    const model = this.selectedModel();
    if (this.loading || this.saving || !this.conversationId || !model?.thinking?.options.includes(level)
      || (model.thinking.mode !== 'levels' && model.thinking.mode !== 'toggle')) return false;
    if (level === this.thinkingLevel) return true;
    this.saving = true; this.error = ''; const generation = ++this.generation;
    try {
      const config = await this.repository.setModel(this.conversationId, this.modelId, level, this.configVersion);
      if (generation !== this.generation) return false;
      this.configVersion = config?.configVersion;
      this.modelId = config?.model ?? this.modelId; this.thinkingLevel = config?.thinkingLevel ?? level;
      if (remember) await this.repository.rememberModel(this.agentId, this.modelId, this.thinkingLevel);
      return generation === this.generation;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return false; }
    finally { this.saving = false; }
  }
  async refreshPreparation(): Promise<void> {
    const id = this.conversationId; if (!id) return;
    const request = ++this.preparationRequest;
    try {
      const state = await this.repository.inputState(id);
      if (request !== this.preparationRequest) return;
      this.preparation = state.preparation;
      this.preparationError = state.preparation?.state === 'preparation_failed'
        ? state.preparation.lastError || 'SESSION_PREPARATION_FAILED' : '';
    } catch (_error) { /* Keep the last known preparation state. */ }
  }
  async retryPreparation(useLocalCheckout: boolean = false): Promise<void> {
    if (this.preparationBusy) return;
    const preparation = this.preparation;
    if (!preparation || preparation.state !== 'preparation_failed'
      || (useLocalCheckout && preparation.executionMode !== 'managed_worktree')) return;
    const id = this.conversationId;
    const generation = this.generation;
    this.preparationBusy = true;
    this.preparationRequest++;
    try {
      await this.repository.retryPreparation(id, preparation.operationId, preparation.revision,
        useLocalCheckout ? 'local_checkout' : undefined);
      if (generation === this.generation) await this.refreshPreparation();
    } catch (error) { if (generation === this.generation) this.preparationError = (error as Error).message; }
    finally { if (generation === this.generation) this.preparationBusy = false; }
  }
}
