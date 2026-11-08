import { stream } from 'hono/streaming';
import type { Hono } from 'hono';
import { z } from 'zod';

import { resumeChildRun } from '../../../agent/orchestration/child-run-resume.js';
import { manageTuiCapability, tuiManagementSchema } from '../../../tui/tui-management.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getSessionConfig } from '../../../storage/sqlite/config-repository.js';
import { listTuiCapabilities } from '../../../tui/tui-capabilities.js';
import { getChildRunMessages, steerChildRun, listChildRuns, getChildRun, stopChildRun } from '../../../agent/orchestration/child-run-monitor.js';
import { getSessionInteractionPolicy, setSessionInteractionPolicy, sessionInteractionPolicySchema } from '../../../agent/session/interaction-policy.js';
import type { Config } from '../../../config/schema.js';
import { resolveEffectiveAgentProfile } from '../../../config/agent-profile.js';
import { getProjectForSession } from '../../../projects/workspace.js';
import { ProjectService } from '../../../projects/index.js';
import { effectiveWorkspacePathForSession, projectWorkspacePath } from '../../../session/session-workspace.js';
import { searchTuiHistory, resizeTuiJob, getTuiWorkspaceDiff, getTuiJob, listTuiJobs, stopTuiJob, writeTuiJob } from '../../../tui/backend-services.js';
import { collectTuiStartupResources } from '../../../tui/tui-startup-resources.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerTuiRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.use('/api/tui/sessions/:id/*', async (c, next) => {
    if (!z.uuid().safeParse(c.req.param('id')).success) return c.json({ ok: false, error: 'Invalid conversation UUID' }, 400);
    await next();
  });
  authenticated.post('/api/tui/sessions/:id/search', async c => {
    const input = z.strictObject({ query: z.string().trim().min(1).max(1000) }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid search query' }, 400);
    return c.json({ ok: true, payload: searchTuiHistory(c.req.param('id'), input.data.query) });
  });
  authenticated.get('/api/tui/sessions/:id/policy', (c) => c.json({ ok: true, payload: getSessionInteractionPolicy(c.req.param('id')) }));
  authenticated.post('/api/tui/sessions/:id/policy', deps.chatRateLimitMiddleware, async (c) => {
    const input = sessionInteractionPolicySchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid session interaction policy' }, 400);
    try {
      return c.json({ ok: true, payload: setSessionInteractionPolicy(c.req.param('id'), input.data) });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  authenticated.get('/api/tui/sessions/:id/subagents', (c) => c.json({ ok: true, payload: listChildRuns(c.req.param('id')) }));
  authenticated.get('/api/tui/sessions/:id/subagents/:child', (c) => {
    try { return c.json({ ok: true, payload: getChildRun(c.req.param('id'), c.req.param('child')) }); }
    catch { return c.json({ ok: false, error: 'Subagent not found in this conversation' }, 404); }
  });
  authenticated.post('/api/tui/sessions/:id/subagents/:child/stop', deps.chatRateLimitMiddleware, (c) => {
    try {
      stopChildRun(c.req.param('id'), c.req.param('child'));
      return c.json({ ok: true, payload: null });
    } catch { return c.json({ ok: false, error: 'Subagent not found in this conversation' }, 404); }
  });
  authenticated.get('/api/tui/sessions/:id/subagents/:child/transcript', c => {
    try { return c.json({ ok: true, payload: JSON.stringify(getChildRunMessages(c.req.param('id'), c.req.param('child')), null, 2) }); }
    catch { return c.json({ ok: false, error: 'Child not found in this conversation' }, 404); }
  });
  for (const action of ['steer', 'resume'] as const) authenticated.post(`/api/tui/sessions/:id/subagents/:child/${action}`, deps.chatRateLimitMiddleware, async c => {
    const input = z.strictObject({ text: z.string().trim().min(1).max(32000) }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid child input' }, 400);
    try {
      if (action === 'steer') await steerChildRun(c.req.param('id'), c.req.param('child'), input.data.text);
      else await resumeChildRun(c.req.param('id'), c.req.param('child'), input.data.text, deps.service.getConfig());
      return c.json({ ok: true, payload: null });
    } catch (error) { return c.json({ ok: false, error: String(error) }, 409); }
  });
  authenticated.get('/api/tui/sessions/:id/jobs', (c) => c.json({ ok: true, payload: listTuiJobs(c.req.param('id')) }));
  authenticated.get('/api/tui/sessions/:id/jobs/:job', (c) => {
    try { return c.json({ ok: true, payload: getTuiJob(c.req.param('id'), c.req.param('job')) }); }
    catch { return c.json({ ok: false, error: 'Background job not found in this conversation' }, 404); }
  });
  authenticated.post('/api/tui/sessions/:id/jobs/:job/stop', deps.chatRateLimitMiddleware, async (c) => {
    try {
      await stopTuiJob(c.req.param('id'), c.req.param('job'));
      return c.json({ ok: true, payload: null });
    } catch (error) { return c.json({ ok: false, error: String(error) }, 409); }
  });
  authenticated.post('/api/tui/sessions/:id/jobs/:job/resize', deps.chatRateLimitMiddleware, async c => {
    const input = z.strictObject({ cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(1000) }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid terminal size' }, 400);
    try { resizeTuiJob(c.req.param('id'), c.req.param('job'), input.data.cols, input.data.rows); return c.json({ ok: true, payload: null }); }
    catch (error) { return c.json({ ok: false, error: String(error) }, 409); }
  });
  authenticated.post('/api/tui/sessions/:id/jobs/:job/stdin', deps.chatRateLimitMiddleware, async (c) => {
    const input = z.object({ text: z.string().max(65536) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid background input' }, 400);
    try {
      writeTuiJob(c.req.param('id'), c.req.param('job'), input.data.text);
      return c.json({ ok: true, payload: null });
    } catch (error) { return c.json({ ok: false, error: String(error) }, 409); }
  });
  authenticated.post('/api/tui/side', deps.chatRateLimitMiddleware, async c => {
    const body = z.strictObject({ conversationId: z.string().uuid(), question: z.string().trim().min(1).max(64000), agentId: z.string().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ok: false, error: 'Invalid side question' }, 400);
    const profile = body.data.agentId ? resolveEffectiveAgentProfile(body.data.agentId) : undefined;
    c.header('Content-Type', 'application/x-ndjson'); c.header('Cache-Control', 'no-store');
    return stream(c, async output => {
      const controller = new AbortController(); output.onAbort(() => controller.abort());
      const result = await deps.service.sessions.btwQuery(body.data.conversationId, body.data.question, {
        signal: controller.signal, onTextDelta: async delta => { await output.write(JSON.stringify({ delta }) + '\n'); },
        ...(profile ? { agentId: profile.agentId, modelRef: profile.primaryModelRef, includeSessionContext: false } : {}) });
      if (!controller.signal.aborted) await output.write(JSON.stringify({ result }) + '\n');
    });
  });
  authenticated.post('/api/tui/manage', deps.strictRateLimitMiddleware, async c => {
    const principal = getGatewayPrincipal(c);
    if (principal.kind !== 'owner' || !principal.scopes.includes('gateway.admin')) return c.json({ ok: false, error: 'Owner administration is required.' }, 403);
    const command = tuiManagementSchema.safeParse(await c.req.json().catch(() => null));
    if (!command.success) return c.json({ ok: false, error: 'Invalid capability action' }, 400);
    const conversationId = c.req.query('conversationId');
    const agentId = c.req.query('agentId');
    const projectId = c.req.query('projectId');
    try {
      const project = !conversationId && projectId ? new ProjectService().get(projectId) : null;
      if (projectId && !project) throw new Error('Project not found');
      const workspace = !conversationId && agentId ? projectWorkspacePath(project) ?? resolveEffectiveAgentProfile(agentId).resolvedWorkspacePath
        : effectiveWorkspacePathForSession(deps.service.getConfig(), conversationId, conversationId ? getSessionConfig(conversationId) : null, getProjectForSession(conversationId));
      return c.json({ ok: true, payload: await manageTuiCapability({ command: command.data, conversationId, config: deps.service.getConfig(), workspace, owner: principal.principalId }) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  authenticated.get('/api/tui/capabilities/:kind', (c) => {
    const kind = z.enum(['skills', 'mcp', 'plugins']).safeParse(c.req.param('kind'));
    if (!kind.success) return c.json({ ok: false, error: 'Unknown capability kind' }, 400);
    try {
      const conversationId = c.req.query('conversationId')?.trim();
      const agentId = c.req.query('agentId')?.trim();
      const projectId = c.req.query('projectId')?.trim();
      const project = !conversationId && projectId ? new ProjectService().get(projectId) : null;
      if (projectId && !project) throw new Error('Project not found');
      const workspace = !conversationId && agentId
        ? projectWorkspacePath(project) ?? resolveEffectiveAgentProfile(agentId).resolvedWorkspacePath
        : effectiveWorkspacePathForSession(deps.service.getConfig(), conversationId, conversationId ? getSessionConfig(conversationId) : null, getProjectForSession(conversationId));
      return c.json({ ok: true, payload: listTuiCapabilities({ config: deps.service.getConfig(), workspace,
        agentId, kind: kind.data }) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  authenticated.get('/api/tui/diff', async (c) => {
    try {
      const conversationId = c.req.query('conversationId')?.trim();
      const agentId = c.req.query('agentId')?.trim();
      const projectId = c.req.query('projectId')?.trim();
      const project = !conversationId && projectId ? new ProjectService().get(projectId) : null;
      if (projectId && !project) throw new Error('Project not found');
      const workspace = !conversationId && agentId
        ? projectWorkspacePath(project) ?? resolveEffectiveAgentProfile(agentId).resolvedWorkspacePath
        : effectiveWorkspacePathForSession(deps.service.getConfig(), conversationId, conversationId ? getSessionConfig(conversationId) : null, getProjectForSession(conversationId));
      return c.json({ ok: true, payload: await getTuiWorkspaceDiff(workspace) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  authenticated.get('/api/tui/startup-resources', (c) => {
    const conversationId = c.req.query('conversationId')?.trim() || undefined;
    const agentId = conversationId ? undefined : c.req.query('agentId')?.trim();
    const payload = collectTuiStartupResources(deps.service.currentConfig as Config, conversationId, { agentId });
    return c.json({ ok: true, payload });
  });
}
