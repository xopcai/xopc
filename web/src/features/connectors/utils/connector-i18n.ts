export function formatConnectorMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replaceAll(`{{${key}}}`, value), template);
}
