export function resolveAutomationWebhookSecret(secretId: string): string | undefined {
  const raw = process.env.XOPC_AUTOMATION_WEBHOOK_SECRETS?.trim();
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('XOPC_AUTOMATION_WEBHOOK_SECRETS must be a JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('XOPC_AUTOMATION_WEBHOOK_SECRETS must be a JSON object');
  }
  const value = (parsed as Record<string, unknown>)[secretId];
  return typeof value === 'string' && value.length >= 16 ? value : undefined;
}
