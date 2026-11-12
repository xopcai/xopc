const credentialFields = { dingtalk: ['clientSecret'], wecom: ['secret'], slack: ['botToken', 'appToken', 'credentialIdentity'], discord: ['botToken', 'credentialIdentity'] } as const;

export function redactEnterpriseChannelSecret(channel: string, value: unknown): unknown {
  if (!Object.hasOwn(credentialFields, channel) || !value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const sanitized = { ...value } as Record<string, unknown>;
  for (const field of credentialFields[channel as keyof typeof credentialFields]) delete sanitized[field];
  return sanitized;
}
