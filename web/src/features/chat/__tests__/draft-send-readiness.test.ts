import { beforeEach, expect, it } from 'vitest';
import { draftAgentConfig, type LocalSessionDraft } from '../session/local-session-drafts';
import { patchSessionAgentConfigView } from '../session/patch-session-agent-config-view';
import { useChatSessionStore } from '../session/chat-session-store';
import { isSessionModelReady } from '../session/session-model-ready';

const id = '07dd9808-025a-4cbf-85be-eeff56a86821';
const draft: LocalSessionDraft = { conversationId: id, createdAt: new Date().toISOString(),
  creation: { agentId: 'main', model: 'test/model', thinkingLevel: 'off', temporary: false, projectId: null, execution: null } };
const models = [{ id: 'test/model' }];
const session = () => useChatSessionStore.getState().sessions[id];
beforeEach(() => useChatSessionStore.setState({ sessions: {} }));

it('enables first send from real draft config without inventing a server config version', () => {
  patchSessionAgentConfigView(id, draftAgentConfig(draft));
  expect(session().configVersion).toBeUndefined();
  expect(isSessionModelReady(session(), models)).toBe(true);
  expect(isSessionModelReady(session(), [])).toBe(false);
});

it('switches to versioned readiness on acceptance and ignores late draft hydration', () => {
  patchSessionAgentConfigView(id, draftAgentConfig(draft));
  patchSessionAgentConfigView(id, { model: 'test/model', configVersion: 1 });
  expect(session().localDraft).toBe(false);
  expect(isSessionModelReady(session(), models)).toBe(true);
  patchSessionAgentConfigView(id, draftAgentConfig(draft));
  expect(session()).toMatchObject({ configVersion: 1, localDraft: false });
});

it('does not unlock a formal session before its configuration is loaded', () => {
  patchSessionAgentConfigView(id, { model: 'test/model' });
  expect(isSessionModelReady(session(), models)).toBe(false);
  expect(isSessionModelReady(undefined, models)).toBe(false);
});
