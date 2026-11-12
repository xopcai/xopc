const credentialFields = { dingtalk: 'clientSecret', wecom: 'secret' } as const;

export function redactEnterpriseChannelSecret(channel: string, value: unknown): unknown {
  if (!Object.hasOwn(credentialFields, channel) || !value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const sanitized = { ...value } as Record<string, unknown>;
  delete sanitized[credentialFields[channel as keyof typeof credentialFields]];
  return sanitized;
}
