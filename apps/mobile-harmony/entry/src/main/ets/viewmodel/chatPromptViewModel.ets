import { XopcClarification, XopcClarificationCommand, XopcClarificationResponse, validClarificationQuestions, validClarificationAnswers } from '../model/clarification';
import { gatewaySession } from '../service/gatewaySession';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { XopcPayload } from '../model/realtime';
import { localSessionStore } from '../service/localSessionStore';

interface XopcClarificationSnapshot { clarification?: XopcClarification; serverTime?: number; }

@ObservedV2
export class XopcChatPromptViewModel {
  @Trace prompt?: XopcClarification;
  @Trace busy: boolean = false;
  @Trace error: string = '';
  @Trace draftRecord: string = '';
  private persist: Promise<void> = Promise.resolve();
  private draftKey(prompt: XopcClarification): string {
    return localSessionStore.scope() + ':clarify:' + prompt.conversationId + ':' + prompt.id + ':' + prompt.version;
  }
  updateDraft(record: string): void {
    const prompt = this.prompt;
    if (!prompt || this.busy) return;
    this.request++;
    this.draftRecord = record;
    const key = this.draftKey(prompt);
    const generation = this.generation;
    this.persist = this.persist.catch((_error: Error): void => {}).then(async (): Promise<void> => {
      await localSessionStore.writeComposer(key, record);
    });
    this.persist.catch((error: Error): void => { if (generation === this.generation) this.error = error.message; });
  }
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
      if (await localSessionStore.read(this.conversationId)) return;
      const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(this.conversationId) + '/clarification')) as XopcPayload<XopcClarificationSnapshot>;
      if (!result.payload) throw new Error('INVALID_CLARIFICATION');
      if (request !== this.request) return;
      const prompt = result.payload.clarification;
      if (prompt && ((prompt.schemaVersion !== undefined && ![1, 2].includes(prompt.schemaVersion)) || (prompt.schemaVersion === 2 && !validClarificationQuestions(prompt)))) throw new Error('UNSUPPORTED_CLARIFICATION');
      if (prompt?.expiresAt && result.payload.serverTime) prompt.expiresAt -= result.payload.serverTime - Date.now();
      let draftRecord: string = '';
      if (prompt?.schemaVersion === 2 && prompt.status === 'open') {
        draftRecord = await localSessionStore.readComposer(this.draftKey(prompt)) ?? '';
        if (request !== this.request) return;
      }
      this.draftRecord = draftRecord;
      this.prompt = prompt?.status === 'open' && prompt.conversationId === this.conversationId
        && (!prompt.expiresAt || prompt.expiresAt > Date.now()) ? prompt : undefined;
      clearTimeout(this.expiryTimer);
      if (this.prompt?.expiresAt) this.expiryTimer = setTimeout((): void => { this.prompt = undefined; this.refresh(); }, Math.max(0, this.prompt.expiresAt - Date.now()) + 1);
    } catch (error) { if (request === this.request) this.error = (error as Error).message; }
  }
  async respond(command: XopcClarificationCommand): Promise<void> {
    const prompt = this.prompt;
    if (this.busy || !prompt || !['answer', 'agent_decide', 'cancel'].includes(command.action)
      || (prompt.kind === 'approval' && command.action === 'agent_decide') || (prompt.expiresAt !== undefined && prompt.expiresAt <= Date.now())) return;
    if (prompt.schemaVersion === 2 && command.action === 'answer' && !validClarificationAnswers(prompt, command.answers ?? [])) return;
    const key = prompt.schemaVersion === 2 ? this.draftKey(prompt) : '';
    const connection = gatewaySession.connectionRevision();
    const generation = this.generation; this.busy = true; this.error = ''; this.request++;
    const signature = JSON.stringify([prompt.id, prompt.version, command]);
    if (signature !== this.signature) { this.signature = signature; this.identity = this.crypto.uuid(); }
    try {
      let body: XopcClarificationResponse = { action: command.action, response: command.response, decision: command.decision,
        schemaVersion: command.schemaVersion, answers: command.answers, expectedVersion: prompt.version, idempotencyKey: this.identity };
      if (prompt.schemaVersion === 2) {
        if (command.schemaVersion !== 2) throw new Error('INVALID_CLARIFICATION_VERSION');
        await this.persist;
        const saved = await localSessionStore.readComposer(key + ':attempt');
        if (saved) body = JSON.parse(saved) as XopcClarificationResponse;
        else await localSessionStore.writeComposer(key + ':attempt', JSON.stringify(body));
      }
      if (generation !== this.generation) return;
      gatewaySession.assertConnection(connection);
      await gatewaySession.request('/api/clarifications/' + encodeURIComponent(prompt.id) + '/responses', 'POST', JSON.stringify(body));
      if (generation !== this.generation) return;
      if (prompt.schemaVersion === 2) {
        await localSessionStore.writeComposer(key, undefined);
        await localSessionStore.writeComposer(key + ':attempt', undefined);
      }
      this.prompt = undefined; this.signature = ''; clearTimeout(this.expiryTimer);
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
}
