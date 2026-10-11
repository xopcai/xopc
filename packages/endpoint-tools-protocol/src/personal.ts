import type { EndpointToolDescriptor } from './index.js';
import { DEVICE_EMPTY_INPUT_SCHEMA, ENDPOINT_CONTACT_OUTPUT_SCHEMA, ENDPOINT_FILE_OUTPUT_SCHEMA } from './shared-schemas.js';

export const PERSONAL_TOOL_NAMES = ['mobile.file.pick', 'mobile.media.pick', 'mobile.camera.capture', 'mobile.contacts.pick', 'mobile.calendar.query_events', 'mobile.calendar.query_free_busy'] as const;
export type PersonalToolName = typeof PERSONAL_TOOL_NAMES[number];
export const CONTACT_PICK_INPUT_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['field'], properties: { field: { enum: ['phone', 'email'] } } } as const;
export const CALENDAR_INPUT_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['startAt', 'endAt'], properties: {
    startAt: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    endAt: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
  } } as const;
export const CALENDAR_OUTPUT_SCHEMA = { type: 'array', minItems: 1, maxItems: 1,
  items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: {
    type: { const: 'json' }, value: { type: 'object', additionalProperties: false,
      required: ['capturedAt', 'startAt', 'endAt', 'timeZone', 'accessScope', 'truncated', 'events'], properties: {
        capturedAt: { type: 'integer', minimum: 0 }, startAt: { type: 'integer', minimum: 0 }, endAt: { type: 'integer', minimum: 0 },
        timeZone: { type: 'string', minLength: 1, maxLength: 100 }, accessScope: { enum: ['all_accessible', 'app_only'] }, truncated: { type: 'boolean' },
        events: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false,
          required: ['startAt', 'endAt', 'allDay', 'busy'], properties: {
            startAt: { type: 'integer', minimum: 0 }, endAt: { type: 'integer', minimum: 0 },
            allDay: { type: 'boolean' }, busy: { type: 'boolean' }, title: { type: 'string', maxLength: 500 },
          } } },
      } },
  } } } as const;

/** User-mediated reads disclose only the selected item, never a device inventory. */
export function personalDescriptor(name: PersonalToolName): EndpointToolDescriptor {
  const calendar = name.includes('.calendar.');
  const contact = name === 'mobile.contacts.pick';
  const titles: Record<PersonalToolName, string> = {
    'mobile.file.pick': 'Ask the user to select one file', 'mobile.media.pick': 'Ask the user to select one photo',
    'mobile.camera.capture': 'Ask the user to take one photo', 'mobile.contacts.pick': 'Ask the user to select a contact field',
    'mobile.calendar.query_events': 'Read calendar events for an approved time range',
    'mobile.calendar.query_free_busy': 'Read calendar availability without event titles',
  };
  return { name, title: titles[name], description: titles[name] + '. Uses the device that sent this message, requires foreground user participation, and may be cancelled. Selected content is sent to the Agent and may appear in chat history.'
    + (calendar ? ' Range must be at most seven days. Only locally accessible calendars are covered; truncated or app-only results cannot establish that the user is free.' : ''),
    inputSchema: calendar ? CALENDAR_INPUT_SCHEMA : contact ? CONTACT_PICK_INPUT_SCHEMA : DEVICE_EMPTY_INPUT_SCHEMA,
    outputSchema: calendar ? CALENDAR_OUTPUT_SCHEMA : contact ? ENDPOINT_CONTACT_OUTPUT_SCHEMA : ENDPOINT_FILE_OUTPUT_SCHEMA,
    policyId: calendar ? 'personal.foreground-read' : 'personal.foreground-mediated-read', sensitivity: 'personal', effect: 'read',
    confirmation: calendar ? 'always' : 'never', requiresForeground: true,
    requiredPermissions: [calendar ? 'calendar-read-once' : contact ? 'contacts-read-selected' : name === 'mobile.camera.capture' ? 'camera-capture-once' : 'file-read'],
    timeoutMs: 120000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: [calendar || contact ? 'json' : 'file'],
  };
}
