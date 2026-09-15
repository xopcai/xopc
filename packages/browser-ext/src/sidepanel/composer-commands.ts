import { gatewayFetch } from './auth';
import { t } from '../i18n';

export type ComposerCommand = { id: string; name: string; description: string; wire: string; disabled?: boolean };
export function findCommand(value: string, cursor: number) {
  const match = /(?:^|\s)\/([\w.-]*)$/.exec(value.slice(0, cursor));
  return match ? { start: cursor - match[1].length - 1, end: cursor, query: match[1] } : undefined;
}
export async function loadComposerCommands(sessionKey?: string): Promise<ComposerCommand[]> {
  const params = new URLSearchParams(sessionKey ? { sessionKey } : {});
  const responses = await Promise.all([
    gatewayFetch('/api/commands'), gatewayFetch(`/api/chat/skills?${params}`),
  ]);
  for (const response of responses) if (!response.ok) throw new Error(t('errorGatewayStatus', String(response.status)));
  const [commands, skills] = await Promise.all(responses.map(response => response.json()));
  return [
    ...(commands.payload?.commands ?? []).map((command: { name: string; description: string }) => ({
      id: `command:${command.name}`, name: `/${command.name}`, description: command.description, wire: `/${command.name} `,
    })),
    ...(skills.payload?.skills ?? []).map((skill: { name: string; description: string; availableForCurrentAgent: boolean }) => ({
      id: `skill:${skill.name}`, name: skill.name, description: skill.description, wire: `/skill:${skill.name} `, disabled: !skill.availableForCurrentAgent,
    })),
  ];
}
