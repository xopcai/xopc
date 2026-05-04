/**
 * Standing goal extension — thick logic for webchat `/goal`-style loops.
 * Core only emits `webchat_turn_complete`; this module judges + schedules continuations.
 */

import type { ExtensionApi, HookAgentContext, WebchatTurnCompleteEvent } from '@xopcai/xopc/extension-sdk';
import { complete, type UserMessage } from '@mariozechner/pi-ai';
import { resolveModel } from '@xopcai/xopc/providers/index.js';
import { parseSessionKey } from '@xopcai/xopc/routing/session-key.js';

const AUTO_PREFIX = '[standing-goal:auto]';
const CUSTOM_KEY = 'standingGoal';

type StandingGoalStored = {
  goalText: string;
  maxAutoSteps: number;
  autoStepsUsed: number;
  judgeModelRef?: string;
};

function isWebchatSessionKey(sessionKey: string): boolean {
  const p = parseSessionKey(sessionKey);
  return p?.source === 'webchat' || sessionKey.includes(':webchat:');
}

function defaultModelRef(cfg: unknown): string | undefined {
  const root = cfg as Record<string, unknown> | undefined;
  const agents = root?.agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return undefined;
  const defaults = (agents as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return undefined;
  const model = (defaults as Record<string, unknown>).model;
  if (typeof model === 'string' && model.trim()) return model.trim();
  if (model && typeof model === 'object' && !Array.isArray(model)) {
    const primary = (model as Record<string, unknown>).primary;
    if (typeof primary === 'string' && primary.trim()) return primary.trim();
  }
  return undefined;
}

/** Merge `customData.standingGoal` for HTTP + `/goal` command. */
async function patchStandingGoalInSession(
  sm: {
    getSessionMetadata: (key: string) => Promise<{ customData?: unknown } | null>;
    updateSessionMetadata: (key: string, updates: { customData?: Record<string, unknown> }) => Promise<void>;
  },
  sessionKey: string,
  patch:
    | { kind: 'clear' }
    | { kind: 'set'; goalText: string; maxAutoSteps: number; judgeModelRef?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const meta = await sm.getSessionMetadata(sessionKey);
  if (!meta) return { ok: false, error: 'Session not found' };
  const base = { ...(meta.customData as Record<string, unknown> | undefined) };
  if (patch.kind === 'clear') {
    delete base[CUSTOM_KEY];
  } else {
    base[CUSTOM_KEY] = {
      goalText: patch.goalText,
      maxAutoSteps: patch.maxAutoSteps,
      autoStepsUsed: 0,
      ...(patch.judgeModelRef ? { judgeModelRef: patch.judgeModelRef } : {}),
    };
  }
  await sm.updateSessionMetadata(sessionKey, { customData: base });
  return { ok: true };
}

function readStored(meta: Record<string, unknown> | undefined): StandingGoalStored | null {
  const raw = meta?.[CUSTOM_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const goalText = typeof o.goalText === 'string' ? o.goalText.trim() : '';
  if (!goalText) return null;
  const maxAutoSteps =
    typeof o.maxAutoSteps === 'number' && Number.isFinite(o.maxAutoSteps)
      ? Math.max(0, Math.min(50, Math.floor(o.maxAutoSteps)))
      : 8;
  const autoStepsUsed =
    typeof o.autoStepsUsed === 'number' && Number.isFinite(o.autoStepsUsed)
      ? Math.max(0, Math.floor(o.autoStepsUsed))
      : 0;
  const judgeModelRef = typeof o.judgeModelRef === 'string' ? o.judgeModelRef.trim() : undefined;
  return { goalText, maxAutoSteps, autoStepsUsed, judgeModelRef };
}

function parseJudgeJson(text: string): { done: boolean; reason: string } {
  const t = text.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return { done: true, reason: 'unparseable judge output' };
  try {
    const o = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    const done = Boolean(o.done);
    const reason = typeof o.reason === 'string' ? o.reason : '';
    return { done, reason };
  } catch {
    return { done: true, reason: 'invalid judge JSON' };
  }
}

async function runJudge(
  modelRef: string,
  goalText: string,
  inboundUserText: string,
  assistantPlainText: string,
): Promise<{ done: boolean; reason: string }> {
  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(modelRef);
  } catch {
    return { done: true, reason: 'model not configured' };
  }

  const prompt = `You judge whether a "standing goal" for an assistant session is fully satisfied.

Standing goal:
${goalText.slice(0, 4000)}

Last user message (plain):
${inboundUserText.slice(0, 3000)}

Last assistant reply (plain):
${assistantPlainText.slice(0, 8000)}

Reply with ONLY valid JSON, no markdown: {"done":true|false,"reason":"one short phrase"}`;

  const userMsg: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const result = await complete(
      model,
      { messages: [userMsg] },
      { maxTokens: 128, temperature: 0.2, signal: controller.signal },
    );
    let text = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          text += String((c as { text?: string }).text || '');
        }
      }
    }
    return parseJudgeJson(text);
  } catch {
    return { done: true, reason: 'judge call failed' };
  } finally {
    clearTimeout(timer);
  }
}

export default function standingGoalExtension(api: ExtensionApi) {
  const extCfg = api.extensionConfig;
  const continuationBody =
    (typeof extCfg.continuationBody === 'string' && extCfg.continuationBody.trim()) ||
    'Take the next concrete step toward the standing goal. Do not greet; focus on progress.';
  const configuredMax =
    typeof extCfg.maxAutoSteps === 'number' && Number.isFinite(extCfg.maxAutoSteps)
      ? Math.max(0, Math.min(50, Math.floor(extCfg.maxAutoSteps)))
      : 8;
  const extensionJudgeRef =
    typeof extCfg.judgeModelRef === 'string' && extCfg.judgeModelRef.trim()
      ? extCfg.judgeModelRef.trim()
      : undefined;

  api.registerCommand({
    name: 'goal',
    description: 'Set, show, or clear webchat standing goal (judge + optional auto-continuation)',
    acceptsArgs: true,
    scope: ['global', 'private', 'group'],
    examples: ['/goal Ship the login fix', '/goal status', '/goal clear'],
    handler: async (args, ctx) => {
      const sm = api.runtime.sessionManager;
      if (!sm?.getSessionMetadata || !sm.updateSessionMetadata) {
        return {
          content: 'Standing goal needs the gateway with session APIs (CLI-only runs cannot use /goal).',
          success: false,
        };
      }
      if (!isWebchatSessionKey(ctx.sessionKey)) {
        return {
          content: 'Standing goal only applies to webchat sessions.',
          success: false,
        };
      }
      const t = args.trim();
      if (!t || t.toLowerCase() === 'status') {
        const meta = await sm.getSessionMetadata(ctx.sessionKey);
        const s = readStored(meta?.customData as Record<string, unknown> | undefined);
        if (!s) {
          return {
            content:
              'No standing goal for this session.\n• Set: `/goal <outcome you want>`\n• Clear: `/goal clear`',
            success: true,
          };
        }
        return {
          content: `Standing goal: ${s.goalText}\nAuto-continuations (since last real user turn): ${s.autoStepsUsed}/${s.maxAutoSteps}`,
          success: true,
        };
      }
      if (t.toLowerCase() === 'clear') {
        const r = await patchStandingGoalInSession(sm, ctx.sessionKey, { kind: 'clear' });
        if (!r.ok) return { content: r.error, success: false };
        return { content: 'Standing goal cleared.', success: true };
      }
      const r = await patchStandingGoalInSession(sm, ctx.sessionKey, {
        kind: 'set',
        goalText: t,
        maxAutoSteps: configuredMax,
        judgeModelRef: extensionJudgeRef,
      });
      if (!r.ok) return { content: r.error, success: false };
      return {
        content:
          `Standing goal set (max ${configuredMax} auto-continuation turns after each assistant reply).\n\n` +
          `Tip: use a **multi-step deliverable** (“implement X”, “finish section Y”). One-off questions (e.g. “summarize this week’s news”) work better as a **normal message** without \`/goal\` — \`/goal\` does not start the assistant; it only records the goal for later turns.`,
        success: true,
      };
    },
  });

  api.onHook('webchat_turn_complete', async (event: WebchatTurnCompleteEvent, _ctx: HookAgentContext) => {
    const sessionKey = event.sessionKey;
    if (!sessionKey || !isWebchatSessionKey(sessionKey)) return;

    const sm = api.runtime.sessionManager;
    const schedule = api.runtime.scheduleWebchatContinuation;
    if (!sm?.getSessionMetadata || !sm.updateSessionMetadata || !schedule) return;

    if (event.aborted || event.streamError) return;

    const meta = await sm.getSessionMetadata(sessionKey);
    if (!meta) return;
    let stored = readStored(meta.customData as Record<string, unknown> | undefined);
    if (!stored) return;

    const userLine = (event.inboundUserText ?? '').trimStart();
    const isAutoTurn = userLine.startsWith(AUTO_PREFIX);

    if (!isAutoTurn) {
      stored = { ...stored, autoStepsUsed: 0 };
    }

    const judgeRef = stored.judgeModelRef || extensionJudgeRef || defaultModelRef(api.runtime.config);
    if (!judgeRef) {
      api.logger.warn('Standing goal: no judge model ref; skipping');
      return;
    }

    const verdict = await runJudge(judgeRef, stored.goalText, event.inboundUserText, event.assistantPlainText);

    const baseCustom = { ...(meta?.customData as Record<string, unknown> | undefined) };

    if (verdict.done) {
      delete baseCustom[CUSTOM_KEY];
      try {
        await sm.updateSessionMetadata(sessionKey, { customData: baseCustom });
      } catch (e) {
        api.logger.warn(`Standing goal: clear metadata failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    if (stored.autoStepsUsed >= stored.maxAutoSteps) {
      api.logger.info('Standing goal: max auto steps reached; not scheduling');
      return;
    }

    const nextUsed = stored.autoStepsUsed + 1;
    const nextStored: StandingGoalStored = {
      ...stored,
      maxAutoSteps: stored.maxAutoSteps,
      autoStepsUsed: nextUsed,
    };
    baseCustom[CUSTOM_KEY] = nextStored;

    try {
      await sm.updateSessionMetadata(sessionKey, { customData: baseCustom });
    } catch (e) {
      api.logger.warn(`Standing goal: save metadata failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const msg = `${AUTO_PREFIX}\n\nStanding goal:\n${stored.goalText}\n\n${continuationBody}`;
    schedule(sessionKey, msg);
  });

  api.registerHttpRoute('/api/extensions/standing-goal', async (req) => {
    const sm = api.runtime.sessionManager;
    if (!sm?.getSessionMetadata || !sm.updateSessionMetadata) {
      return { status: 503, body: { ok: false, error: 'Session API not available (Gateway only)' } };
    }

    const url = new URL(req.url, 'http://local');
    const method = req.method.toUpperCase();

    if (method === 'GET') {
      const sessionKey = url.searchParams.get('sessionKey')?.trim();
      if (!sessionKey) {
        return { status: 400, body: { ok: false, error: 'Missing sessionKey' } };
      }
      const m = await sm.getSessionMetadata(sessionKey);
      const s = readStored(m?.customData as Record<string, unknown> | undefined);
      return { status: 200, body: { ok: true, sessionKey, standingGoal: s } };
    }

    if (method === 'POST') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      const clear = body.clear === true;
      if (!sessionKey) {
        return { status: 400, body: { ok: false, error: 'Missing sessionKey' } };
      }
      if (clear) {
        const r = await patchStandingGoalInSession(sm, sessionKey, { kind: 'clear' });
        if (!r.ok) return { status: 404, body: { ok: false, error: r.error } };
        return { status: 200, body: { ok: true, sessionKey, cleared: true } };
      }
      const goalText = typeof body.goalText === 'string' ? body.goalText.trim() : '';
      if (!goalText) {
        return { status: 400, body: { ok: false, error: 'Missing goalText (or set clear:true)' } };
      }
      const maxAutoSteps =
        typeof body.maxAutoSteps === 'number' && Number.isFinite(body.maxAutoSteps)
          ? Math.max(0, Math.min(50, Math.floor(body.maxAutoSteps)))
          : configuredMax;
      const judgeModelRef =
        typeof body.judgeModelRef === 'string' && body.judgeModelRef.trim()
          ? body.judgeModelRef.trim()
          : undefined;
      const r = await patchStandingGoalInSession(sm, sessionKey, {
        kind: 'set',
        goalText,
        maxAutoSteps,
        judgeModelRef,
      });
      if (!r.ok) return { status: 404, body: { ok: false, error: r.error } };
      const m = await sm.getSessionMetadata(sessionKey);
      const standingGoal = readStored(m?.customData as Record<string, unknown> | undefined);
      return { status: 200, body: { ok: true, sessionKey, standingGoal } };
    }

    return { status: 405, body: { ok: false, error: 'Method not allowed' } };
  });

  api.logger.info('Standing goal extension registered');
}
