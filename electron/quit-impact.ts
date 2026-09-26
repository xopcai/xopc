import { getGatewayConnection } from './gateway-process.js';

export type AppQuitImpact = {
  shouldConfirm: boolean;
  blockingCount: number;
  taskTitle?: string;
};

const QUIT_IMPACT_TIMEOUT_MS = 800;

export async function getAppQuitImpact(): Promise<AppQuitImpact> {
  const connection = getGatewayConnection();
  if (!connection) return { shouldConfirm: false, blockingCount: 0 };

  const response = await fetch(`http://127.0.0.1:${connection.port}/api/runtime/quit-impact`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.timeout(QUIT_IMPACT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Quit impact request failed (${response.status})`);
  const body = await response.json() as {
    payload?: {
      shouldConfirm?: unknown;
      blockingCount?: unknown;
      blockingRuns?: Array<{ title?: unknown }>;
    };
  };
  const payload = body.payload;
  if (!payload || typeof payload.shouldConfirm !== 'boolean'
    || typeof payload.blockingCount !== 'number' || !Number.isFinite(payload.blockingCount)) {
    throw new Error('Quit impact response is invalid');
  }
  const title = payload.blockingRuns?.length === 1 && typeof payload.blockingRuns[0]?.title === 'string'
    ? payload.blockingRuns[0].title.trim().slice(0, 120)
    : '';
  return {
    shouldConfirm: payload.shouldConfirm && payload.blockingCount > 0,
    blockingCount: Math.max(0, Math.trunc(payload.blockingCount)),
    ...(title ? { taskTitle: title } : {}),
  };
}
