import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AutomationCreateCapabilityInputSchema, AutomationUpdatePatchSchema, materializeAutomationTrigger } from '../automations/capabilities/write.js';
import { simulateAutomation } from '../automations/draft/index.js';
import { getAutomation } from '../automations/storage/index.js';
import { CreateAutomationSchema } from '../automations/domain/validation.js';
import { canonicalCapabilityJson, CapabilityError, defineAtomicCapability, defineReadCapability, type CapabilityDispatcher, type CapabilityContext } from '../capabilities/runtime/dispatcher.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import type { LocalAppService } from './service.js';
import { automationReadable } from './capabilities/automation-policy.js';

export const AutomationProposalInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), definition: AutomationCreateCapabilityInputSchema }),
  z.strictObject({ kind: z.literal('update'), id: z.string().min(1).max(100), expectedRevision: z.number().int().nonnegative(), patch: AutomationUpdatePatchSchema }),
]);
const proposalResult = z.object({ id: z.uuid(), status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: z.number(), expiresAt: z.number(), automationId: z.string().optional() });
export type AutomationProposal = z.infer<typeof proposalResult> & { extensionId: string; manifestDigest: string;
  grantRevision: string; releaseId: string; digest: string; input: z.infer<typeof AutomationProposalInputSchema>;
  decision?: { approve: boolean; enable: boolean } };
const records = () => new DurableState<AutomationProposal>('local-app-automation-proposals');

export function proposalDefinition(input: AutomationProposal['input']) {
  if (input.kind === 'create') return CreateAutomationSchema.parse({ ...input.definition, trigger: materializeAutomationTrigger(input.definition.trigger) });
  const current = getAutomation(input.id);
  if (!current || current.updatedAtMs !== input.expectedRevision) throw new CapabilityError('REVISION_CONFLICT', 'Automation changed; create a new proposal');
  if (current.management) throw new CapabilityError('FORBIDDEN', 'Managed automations cannot be changed by app proposals');
  const trigger = input.patch.trigger ? materializeAutomationTrigger(input.patch.trigger) : current.trigger;
  const { id: _id, createdAtMs: _createdAtMs, updatedAtMs: _updatedAtMs, state: _state, management: _management, ...fields } = current;
  return CreateAutomationSchema.parse({ ...fields, ...input.patch, trigger });
}

export function readAutomationProposal(extensionId: string, id: string): AutomationProposal {
  const record = records().get(id);
  if (!record || record.extensionId !== extensionId) throw new CapabilityError('NOT_FOUND', 'Proposal not found');
  return record;
}

export function assertProposalCurrent(apps: Pick<LocalAppService, 'getCapabilityAccess'>, proposal: AutomationProposal): void {
  if (proposal.expiresAt <= Date.now()) throw new CapabilityError('FORBIDDEN', 'Proposal expired');
  const access = apps.getCapabilityAccess(proposal.extensionId, proposal.manifestDigest, proposal.grantRevision);
  if (access.releaseId !== proposal.releaseId || !access.resourceScopes.automationProposals
    || !access.bindings.some(item => item.id === 'xopc.automations.propose')) throw new CapabilityError('FORBIDDEN', 'Proposal authority changed');
  if (proposal.input.kind === 'update') {
    const current = getAutomation(proposal.input.id);
    if (!current || !automationReadable(access.resourceScopes, current)) throw new CapabilityError('FORBIDDEN', 'Automation is outside the approved read scope');
  }
}

export function registerAutomationProposalCapabilities(dispatcher: CapabilityDispatcher): void {
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.automations.propose', majorVersion: 1, effect: 'local-write', surfaces: ['extension'], scopes: ['automations.write'],
    description: 'Store an immutable app proposal for host review. Never creates, enables, changes or runs an automation.',
    input: AutomationProposalInputSchema, output: proposalResult,
    requestScope: context => JSON.stringify([context.localApp?.releaseId, context.localApp?.grantRevision]),
    execute(input, context) {
      const app = context.localApp;
      if (!app?.manifestDigest || !app.releaseId || !app.grantRevision || !app.resourceScopes.automationProposals) throw new CapabilityError('FORBIDDEN', 'Installed proposal authority is required');
      if (input.kind === 'update') {
        const current = getAutomation(input.id);
        if (!current || !automationReadable(app.resourceScopes, current)) throw new CapabilityError('FORBIDDEN', 'Automation read authority is required');
      }
      const definition = proposalDefinition(input);
      if (definition.action.kind === 'system') throw new CapabilityError('FORBIDDEN', 'System actions cannot be proposed');
      const all = records().entries();
      for (const [id, record] of all) if (record.expiresAt <= Date.now()) records().delete(id);
      if (records().values().filter(record => record.extensionId === app.extensionId).length >= 50) throw new CapabilityError('UNAVAILABLE', 'Proposal capacity reached');
      const record: AutomationProposal = { id: randomUUID(), extensionId: app.extensionId, manifestDigest: app.manifestDigest,
        grantRevision: app.grantRevision, releaseId: app.releaseId, input,
        digest: createHash('sha256').update(canonicalCapabilityJson(JSON.parse(JSON.stringify(input)))).digest('hex'),
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 86400000 };
      records().set(record.id, record);
      return record;
    },
  }));
  dispatcher.register(defineReadCapability({
    id: 'xopc.automations.get_proposal', majorVersion: 1, effect: 'read', surfaces: ['extension'], scopes: ['automations.read'],
    description: 'Recover the review outcome of an app-owned automation proposal.',
    input: z.strictObject({ id: z.uuid() }), output: proposalResult,
    execute({ id }, context) {
      if (!context.localApp) throw new CapabilityError('FORBIDDEN', 'App identity is required');
      return readAutomationProposal(context.localApp.extensionId, id);
    },
  }));
}

export function automationProposalReview(proposal: AutomationProposal) {
  const definition = proposalDefinition(proposal.input);
  return { proposal, definition, simulation: simulateAutomation(definition),
    before: proposal.input.kind === 'update' ? getAutomation(proposal.input.id) : undefined };
}

export async function resolveAutomationProposal(apps: Pick<LocalAppService, 'getCapabilityAccess'>, dispatcher: CapabilityDispatcher,
  extensionId: string, id: string, decision: { digest: string; approve: boolean; enable: boolean }, caller: CapabilityContext) {
  caller.assertCurrent?.();
  const proposal = readAutomationProposal(extensionId, id);
  if (proposal.digest !== decision.digest) throw new CapabilityError('CONTRACT_CHANGED', 'Proposal changed');
  if (proposal.status !== 'pending') return proposalResult.parse(proposal);
  assertProposalCurrent(apps, proposal);
  if (proposal.decision && (proposal.decision.approve !== decision.approve || proposal.decision.enable !== decision.enable)) {
    throw new CapabilityError('REVISION_CONFLICT', 'A different review decision is already being applied');
  }
  if (!decision.approve) {
    const rejected = { ...proposal, status: 'rejected' as const }; records().set(id, rejected); return proposalResult.parse(rejected);
  }
  if (!proposal.decision) {
    const definition = proposalDefinition(proposal.input);
    if (definition.action.kind === 'system') throw new CapabilityError('FORBIDDEN', 'System actions cannot be approved');
  }
  records().set(id, { ...proposal, decision: { approve: decision.approve, enable: decision.enable } });
  const input = proposal.input.kind === 'create' ? { ...proposal.input.definition, enabled: decision.enable }
    : { id: proposal.input.id, expectedRevision: proposal.input.expectedRevision,
      patch: { ...proposal.input.patch, enabled: decision.enable } };
  const capabilityId = proposal.input.kind === 'create' ? 'xopc.automations.create' : 'xopc.automations.update';
  const context = { ...caller, assertCurrent: () => { caller.assertCurrent?.(); assertProposalCurrent(apps, proposal); } };
  const contract = dispatcher.describe(capabilityId, context);
  const result = await dispatcher.call(capabilityId, input, context, { ...contract, idempotencyKey: `app-proposal:${id}` }) as { automation: { id: string } };
  const approved = { ...proposal, status: 'approved' as const, automationId: result.automation.id };
  records().set(id, approved);
  return proposalResult.parse(approved);
}
