import { apiFetch } from '../../api/client';

export async function agentSteer(sessionKey: string, message: string): Promise<boolean> {
  const trimmed = message.trim();
  if (!trimmed) return false;
  try {
    const res = await apiFetch('/api/agent/steer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey, message: trimmed }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
