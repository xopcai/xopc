import { createHash, randomUUID } from 'node:crypto';
import type { Api, Model, ImageContent } from '@earendil-works/pi-ai';
import type { ComputerModelBinding } from '@xopcai/computer-control-contract';

type AgentTurn = {
  runId: string; binding: ComputerModelBinding; visual: boolean;
  authorize?: (operation: string, args: unknown) => Promise<void>;
  complete?: (operation: string, result: unknown) => Promise<unknown>;
  cleanup?: () => Promise<unknown>;
};
const turns = new Map<string, AgentTurn>();
const frames = new Map<string, { owner: string; runId: string; toolCallId: string; binding: string;
  bytes: Uint8Array; mimeType: string; expiresAt: number }>();

/** Called by the actual embedded model request, never from tool arguments. */
export function bindComputerAgentTurn(owner: string, runId: string, model: Model<Api>): void {
  const previous = turns.get(owner);
  let origin: string;
  try { origin = new URL(model.baseUrl).origin; }
  catch {
    clearComputerFrames(owner);
    if (previous) turns.set(owner, { ...previous, runId, visual: false });
    return;
  }
  const binding: ComputerModelBinding = { planner: 'agent', runId, modelRef: `${model.provider}/${model.id}`,
    origin, runtimeLocation: 'unknown', recipientHash: createHash('sha256').update(JSON.stringify([model.api, model.baseUrl])).digest('hex') };
  turns.set(owner, { ...(previous?.runId === runId ? previous : {}), runId, binding, visual: model.input?.includes('image') === true });
}
export function computerAgentTurn(owner: string): AgentTurn {
  const turn = turns.get(owner);
  if (!turn?.visual) throw new Error('COMPUTER_AGENT_MODEL_REQUIRED');
  return turn;
}
export function setComputerProgramAuthorization(owner: string, authorize: AgentTurn['authorize'], complete?: AgentTurn['complete']): void {
  const turn = turns.get(owner);
  if (turn) { turn.authorize = authorize; turn.complete = complete; }
}
export function retainComputerFrame(owner: string, toolCallId: string, bytes: Uint8Array, mimeType: string): string {
  const turn = computerAgentTurn(owner);
  clearComputerFrames(owner);
  const id = randomUUID();
  frames.set(id, { owner, toolCallId, runId: turn.runId, binding: JSON.stringify(turn.binding),
    bytes: new Uint8Array(bytes), mimeType, expiresAt: Date.now() + 120_000 });
  return id;
}
export function clearComputerFrames(owner: string): void {
  for (const [id, frame] of frames) if (frame.owner === owner || frame.expiresAt <= Date.now()) {
    frame.bytes.fill(0); frames.delete(id);
  }
}
export function computerRequestFrameCleanup(owner: string, runId: string): () => void {
  const captured = [...frames].filter(([, frame]) => frame.owner === owner && frame.runId === runId);
  return () => {
    for (const [id, frame] of captured) if (frames.get(id) === frame) {
      frame.bytes.fill(0); frames.delete(id);
    }
  };
}
/** Projects a copy for one provider request; persisted messages retain only text. */
export function computerImagesForRequest(owner: string, runId: string, toolCallId: string): ImageContent[] {
  const turn = turns.get(owner);
  if (!turn?.visual || turn.runId !== runId) return [];
  const result: ImageContent[] = [];
  for (const [id, frame] of frames) {
    if (frame.expiresAt <= Date.now()) { frame.bytes.fill(0); frames.delete(id); continue; }
    if (frame.owner === owner && frame.runId === runId && frame.toolCallId === toolCallId
      && frame.binding === JSON.stringify(turn.binding)) {
      result.push({ type: 'image', data: Buffer.from(frame.bytes).toString('base64'), mimeType: frame.mimeType });
    }
  }
  return result;
}
export async function endComputerAgentTurn(owner: string, runId: string): Promise<void> {
  const turn = turns.get(owner);
  if (turn?.runId !== runId) return;
  try { await turn.cleanup?.(); }
  finally { clearComputerFrames(owner); turns.delete(owner); }
}
