import { gatewaySession } from '../service/gatewaySession';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { XopcPayload } from '../model/realtime';

export interface XopcClarification {
  id: string; conversationId: string; kind: string; status: string; question: string; choices?: string[];
  suggestedAnswer?: string; version: number; expiresAt?: number;
}
interface XopcClarificationSnapshot { clarification?: XopcClarification; }
interface XopcClarificationResponse { action: string; answer?: string; expectedVersion: number; idempotencyKey: string; }

@ObservedV2
export class XopcChatPromptViewModel {
  @Trace prompt?: XopcClarification;
  @Trace busy: boolean = false;
  @Trace error: string = '';
  private conversationId: string = '';
  private generation: number = 0;
  private request: number = 0;
  private timer: number = -1;
  private expiryTimer: number = -1;
  private signature: string = '';
  private identity: string = '';
  private crypto: XopcDeviceCrypto = new XopcDeviceCrypto();
  start(id: string): void {
    this.pause(); this.generation++; this.conversationId = id; this.prompt = undefined; this.busy = false; this.error = ''; this.signature = ''; this.resume();
  }
  pause(): void { this.request++; clearInterval(this.timer); this.timer = -1; clearTimeout(this.expiryTimer); }
  resume(): void {
    if (!this.conversationId || this.timer !== -1) return;
    this.refresh(); this.timer = setInterval((): void => { this.refresh(); }, 15000);
  }
  dispose(): void { this.pause(); this.generation++; this.conversationId = ''; }
  async refresh(): Promise<void> {
    if (!this.conversationId || this.busy) return;
    const request = ++this.request;
    try {
      const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(this.conversationId) + '/clarification')) as XopcPayload<XopcClarificationSnapshot>;
      if (!result.payload) throw new Error('INVALID_CLARIFICATION');
      if (request !== this.request) return;
      const prompt = result.payload.clarification;
      this.prompt = prompt?.status === 'open' && prompt.conversationId === this.conversationId
        && (!prompt.expiresAt || prompt.expiresAt > Date.now()) ? prompt : undefined;
      clearTimeout(this.expiryTimer);
      if (this.prompt?.expiresAt) this.expiryTimer = setTimeout((): void => { this.prompt = undefined; this.refresh(); }, Math.max(0, this.prompt.expiresAt - Date.now()) + 1);
    } catch (error) { if (request === this.request) this.error = (error as Error).message; }
  }
  async respond(action: string, answer?: string): Promise<void> {
    const prompt = this.prompt;
    if (this.busy || !prompt || !['answer', 'agent_decide', 'cancel'].includes(action)
      || (action === 'answer' && !answer?.trim()) || (prompt.expiresAt !== undefined && prompt.expiresAt <= Date.now())) return;
    const generation = this.generation; this.busy = true; this.error = ''; this.request++;
    const signature = JSON.stringify([prompt.id, prompt.version, action, answer]);
    if (signature !== this.signature) { this.signature = signature; this.identity = this.crypto.uuid(); }
    try {
      const body: XopcClarificationResponse = { action, answer, expectedVersion: prompt.version, idempotencyKey: this.identity };
      await gatewaySession.request('/api/clarifications/' + encodeURIComponent(prompt.id) + '/responses', 'POST', JSON.stringify(body));
      if (generation !== this.generation) return;
      this.prompt = undefined; this.signature = ''; clearTimeout(this.expiryTimer);
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
}
