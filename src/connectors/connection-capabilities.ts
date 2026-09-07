import type { ConnectionNeed } from '@xopcai/gateway-contract';

/** Supported actions for the task capabilities offered by connection candidates. */
const CAPABILITY_ACTIONS: Record<string, Record<string, string[]>> = {
  'composio-slack': { 'messages.search': ['SLACK_SEARCH_ALL', 'SLACK_SEARCH_MESSAGES'] },
  'composio-gmail': {
    'email.search': ['GMAIL_FETCH_EMAILS'], 'email.read': ['GMAIL_FETCH_EMAILS', 'GMAIL_GET_EMAIL'],
  },
  'composio-outlook': {
    'email.search': ['OUTLOOK_LIST_MESSAGES'], 'email.read': ['OUTLOOK_LIST_MESSAGES', 'OUTLOOK_GET_MESSAGE'],
  },
  'composio-googlecalendar': { 'calendar.read': ['GOOGLECALENDAR_EVENTS_LIST', 'GOOGLECALENDAR_FIND_EVENT'] },
  'composio-googledrive': {
    'files.search': ['GOOGLEDRIVE_FIND_FILE', 'GOOGLEDRIVE_LIST_FILES'],
    'files.read': ['GOOGLEDRIVE_DOWNLOAD_FILE', 'GOOGLEDRIVE_GET_FILE', 'GOOGLEDRIVE_GET_FILE_METADATA'],
  },
  'composio-notion': { 'pages.search': ['NOTION_SEARCH'], 'pages.read': ['NOTION_FETCH_PAGE'] },
};

export function isToolInputSchema(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).type === 'object');
}

export function capabilityActions(need: Pick<ConnectionNeed, 'connectorId' | 'capabilities'>): string[][] {
  return need.capabilities.map(capability => /^[A-Z]+_/.test(capability)
    ? [capability] : CAPABILITY_ACTIONS[need.connectorId]?.[capability] ?? []);
}

export function missingConnectionCapabilities(need: Pick<ConnectionNeed, 'connectorId' | 'capabilities'>, actions: Set<string>): string[] {
  return capabilityActions(need).flatMap((alternatives, index) => alternatives.some(action => actions.has(action))
    ? [] : [need.capabilities[index]!]);
}
