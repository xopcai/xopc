import type { SessionInteractionPolicy } from '../agent/session/interaction-policy.js';
import type { TuiBackend } from './tui-backend.js';
import type { TuiState } from './tui-types.js';

export interface TuiControlCommandsContext {
  client: TuiBackend;
  state: TuiState;
  sessionVersion?: () => number;
  input?: (title: string) => Promise<string | undefined>;
  choose: (title: string, options: string[]) => Promise<string | undefined>;
  showText: (title: string, text: string, load?: () => Promise<string>) => void;
  refresh: () => void;
}

export function createTuiControlCommands(context: TuiControlCommandsContext) {
  const { client, state } = context;
  return async (name: string, args: string): Promise<string | undefined> => {
    const conversationId = state.currentConversationId;
    const version = context.sessionVersion?.();
    const isCurrent = () => state.currentConversationId === conversationId && version === context.sessionVersion?.();
    if (name === 'diff') {
      const diff = await client.getWorkspaceDiff(conversationId);
      if (isCurrent()) context.showText('Working tree diff', diff);
      return;
    }
    if (name === 'plan' || name === 'permissions') {
      if (state.activeRunId || state.isCompacting || state.activityStatus === 'sending') throw new Error('Wait for the current run to finish before changing mode or permissions.');
      const current = await client.getInteractionPolicy(conversationId);
      let next: SessionInteractionPolicy;
      if (name === 'plan') {
        if (args && args !== 'on' && args !== 'off') throw new Error('Usage: /plan [on|off]');
        next = { ...current, mode: args === 'on' ? 'plan' : args === 'off' ? 'default' : current.mode === 'plan' ? 'default' : 'plan' };
      } else {
        const choice = args || await context.choose('Session permissions', ['Read only', 'Workspace sandbox · network off', 'Workspace sandbox · network on', 'Configured agent policy']);
        if (!choice || !isCurrent()) return;
        const sandboxed = choice.startsWith('Workspace sandbox');
        const access = sandboxed ? 'configured' : choice === 'Read only' || choice === 'read-only' ? 'read-only'
          : choice === 'Configured agent policy' || choice === 'configured' ? 'configured' : undefined;
        if (!access) throw new Error('Usage: /permissions [read-only|configured]');
        next = { ...current, access, sandbox: sandboxed ? 'workspace-write' : 'unrestricted', network: choice.endsWith('network on') };
      }
      if (!isCurrent()) return;
      const policy = await client.setInteractionPolicy(conversationId, next);
      if (!isCurrent()) return;
      state.sessionInfo.interactionPolicy = policy;
      context.refresh();
      return `Mode: ${policy.mode}. Permissions: ${policy.access}.${policy.mode === 'plan' ? ' Inspection and planning only; switch to Default mode to implement.' : ''}`;
    }
    if (name === 'subagents') {
      const control = /^(steer|resume)\s+(\S+)\s+([\s\S]+)$/.exec(args);
      if (control) {
        if (control[1] === 'steer') await client.steerSubagent(conversationId, control[2]!, control[3]!);
        else await client.resumeSubagent(conversationId, control[2]!, control[3]!);
        return isCurrent() ? `Subagent ${control[1]} accepted.` : undefined;
      }
      const stop = /^stop\s+(\S+)$/.exec(args);
      if (stop) { await client.stopSubagent(conversationId, stop[1]!); return isCurrent() ? 'Subagent stop requested.' : undefined; }
      const children = await client.listSubagents(conversationId);
      if (!isCurrent()) return;
      if (!children.length) return 'No delegated subagents in this conversation.';
      const choices = children.map(child => `${child.id} [${child.status}] ${child.task}`);
      const chosen = args ? children.find(child => child.id === args)?.id : await context.choose('Delegated subagents', choices);
      const id = args || children[choices.indexOf(chosen ?? '')]?.id;
      if (!id || !isCurrent()) return;
      const child = children.find(child => child.id === id);
      const action = await context.choose('Subagent', ['Watch output', 'Open transcript', ...(child?.status === 'running' ? ['Steer', 'Stop'] : ['Resume'])]);
      if (!action || !isCurrent()) return;
      if (action === 'Open transcript') { const transcript = await client.getSubagentTranscript(conversationId, id); if (isCurrent()) context.showText('Child transcript', transcript); return; }
      if (action === 'Stop') { await client.stopSubagent(conversationId, id); return; }
      if (action === 'Steer' || action === 'Resume') {
        const text = await context.input?.(`${action} child ${id}`);
        if (!text || !isCurrent()) return;
        if (action === 'Steer') await client.steerSubagent(conversationId, id, text); else await client.resumeSubagent(conversationId, id, text);
        return;
      }
      const load = async () => { const child = await client.getSubagent(conversationId, id); return `[${child.status}] ${child.task}\n${child.output}\n\n/subagents stop ${id}`; };
      const output = await load();
      if (isCurrent()) context.showText('Subagent work', output, load);
      return;
    }
    if (name === 'ps') {
      if (args) {
        const job = await client.getJob(conversationId, args);
        if (isCurrent()) context.showText(`${job.status} · ${job.command}`, job.aggregatedOutput || '(no output)',
          async () => { const next = await client.getJob(conversationId, args); return `[${next.status}] ${next.command}\n${next.aggregatedOutput || '(no output)'}`; });
        return;
      }
      const jobs = await client.listJobs(conversationId);
      if (!isCurrent()) return;
      return jobs.length ? jobs.map(job => `${job.id} [${job.status}] ${job.command}`).join('\n')
        + '\n/ps <id> output · /stop <id|all> · /stdin <id> <text> (pipe input)'
        : 'No background jobs in this conversation.';
    }
    if (name === 'stop') {
      if (!args) throw new Error('Usage: /stop <job-id|all>. Use Escape or /abort to stop the agent.');
      const ids = args === 'all' ? (await client.listJobs(conversationId)).filter(job => job.status === 'running').map(job => job.id) : [args];
      for (const id of ids) await client.stopJob(conversationId, id);
      return isCurrent() ? `Stopped ${ids.length} background job(s).` : undefined;
    }
    if (name === 'stdin') {
      const match = /^(\S+)\s+([\s\S]+)$/.exec(args);
      if (!match) throw new Error('Usage: /stdin <job-id> <text>');
      await client.writeJob(conversationId, match[1]!, `${match[2]}\n`);
      return isCurrent() ? 'Sent pipe input to the background job.' : undefined;
    }
    throw new Error(`Unknown session control: ${name}`);
  };
}
