import type { EndpointToolDescriptor } from './index.js';
import { DEVICE_EMPTY_INPUT_SCHEMA, ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA, ENDPOINT_CONTACT_OUTPUT_SCHEMA, ENDPOINT_FILE_OUTPUT_SCHEMA } from './shared-schemas.js';

export const PERSONAL_TOOL_NAMES = ['mobile.file.pick', 'mobile.media.pick', 'mobile.camera.capture', 'mobile.contacts.pick', 'mobile.calendar.query_events', 'mobile.calendar.query_free_busy', 'mobile.contacts.find_by_name', 'mobile.calendar.create_event', 'mobile.media.list_recent', 'mobile.media.read_image', 'mobile.media.add_to_album'] as const;
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

const CREATED_ITEM_OUTPUT_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 1, items: {
    type: 'object', additionalProperties: false, required: ['type', 'value'],
    properties: { type: { const: 'json' }, value: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', minLength: 1, maxLength: 512 } },
    } },
  },
} as const;

/** Mobile calendar reads and system-picker tools. */
export function personalDescriptor(name: PersonalToolName): EndpointToolDescriptor {
  if (name === 'mobile.media.list_recent' || name === 'mobile.media.read_image' || name === 'mobile.media.add_to_album') {
    const list = name === 'mobile.media.list_recent';
    const write = name === 'mobile.media.add_to_album';
    const id = { type: 'string', minLength: 1, maxLength: 512 } as const;
    return {
      name, title: list ? 'List recent photos' : write ? 'Add a photo to an album' : 'Read a photo',
      description: list ? 'List up to 20 recently captured photos visible to this app. Returns IDs and timestamps only.'
        : write ? 'Add one authorized photo to a named album, creating the album if needed. Android makes a copy. Requires on-device confirmation.'
          : 'Read one authorized photo by an ID returned by List recent photos. The image may appear in chat history.',
      inputSchema: list ? DEVICE_EMPTY_INPUT_SCHEMA : {
        type: 'object', additionalProperties: false, required: write ? ['id', 'album'] : ['id'],
        properties: write ? { id, album: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' } } : { id },
      },
      outputSchema: write ? CREATED_ITEM_OUTPUT_SCHEMA : list ? {
        type: 'array', minItems: 1, maxItems: 1, items: {
          type: 'object', additionalProperties: false, required: ['type', 'value'],
          properties: { type: { const: 'json' }, value: {
            type: 'array', maxItems: 20, items: {
              type: 'object', additionalProperties: false, required: ['id', 'capturedAt'],
              properties: { id, capturedAt: { type: 'integer', minimum: 0 } },
            },
          } },
        },
      } : ENDPOINT_FILE_OUTPUT_SCHEMA,
      policyId: write ? 'user.foreground-write' : 'personal.mobile-authorized-read',
      sensitivity: 'personal', effect: write ? 'write' : 'read', confirmation: write ? 'always' : 'never',
      requiresForeground: true, requiredPermissions: [write ? 'photos-write' : 'photos-read'],
      timeoutMs: 120000, maxConcurrency: 1, supportsCancellation: true, idempotent: !write,
      resultKinds: [write || list ? 'json' : 'file'],
    };
  }
  if (name === 'mobile.contacts.find_by_name' || name === 'mobile.calendar.create_event') {
    const write = name === 'mobile.calendar.create_event';
    const title = write ? 'Create a calendar event' : 'Find contacts by name';
    return {
      name, title,
      description: write
        ? 'Create one timed event on the foreground device after on-device confirmation. Provide Unix milliseconds.'
        : 'Search authorized contacts by name on the foreground device. Returns up to 20 matches with phone numbers and email addresses.',
      inputSchema: write ? {
        ...CALENDAR_INPUT_SCHEMA, required: ['startAt', 'endAt', 'title'],
        properties: { ...CALENDAR_INPUT_SCHEMA.properties, title: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' } },
      } : {
        type: 'object', additionalProperties: false, required: ['query'],
        properties: { query: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' } },
      },
      outputSchema: write ? CREATED_ITEM_OUTPUT_SCHEMA : ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA,
      policyId: write ? 'user.foreground-write' : 'personal.mobile-authorized-read',
      sensitivity: 'personal', effect: write ? 'write' : 'read', confirmation: write ? 'always' : 'never',
      requiresForeground: true, requiredPermissions: [write ? 'calendar-write' : 'contacts-read'],
      timeoutMs: 120000, maxConcurrency: 1, supportsCancellation: true, idempotent: !write, resultKinds: ['json'],
    };
  }
  const calendar = name.includes('.calendar.');
  const contact = name === 'mobile.contacts.pick';
  const titles: Record<typeof name, string> = {
    'mobile.file.pick': 'Ask the user to select one file', 'mobile.media.pick': 'Ask the user to select one photo',
    'mobile.camera.capture': 'Ask the user to take one photo', 'mobile.contacts.pick': 'Ask the user to select a contact field',
    'mobile.calendar.query_events': 'Read calendar events for a time range',
    'mobile.calendar.query_free_busy': 'Read calendar availability without event titles',
  };
  return { name, title: titles[name], description: titles[name] + (calendar
    ? '. Uses the foreground device that sent this message after system calendar authorization. Results may appear in chat history.'
    : '. Uses the device that sent this message, requires foreground user participation, and may be cancelled. Selected content is sent to the Agent and may appear in chat history.')
    + (calendar ? ' Range must be at most seven days. Only locally accessible calendars are covered; truncated or app-only results cannot establish that the user is free.' : ''),
    inputSchema: calendar ? CALENDAR_INPUT_SCHEMA : contact ? CONTACT_PICK_INPUT_SCHEMA : DEVICE_EMPTY_INPUT_SCHEMA,
    outputSchema: calendar ? CALENDAR_OUTPUT_SCHEMA : contact ? ENDPOINT_CONTACT_OUTPUT_SCHEMA : ENDPOINT_FILE_OUTPUT_SCHEMA,
    policyId: calendar ? 'personal.mobile-authorized-read' : 'personal.foreground-mediated-read', sensitivity: 'personal', effect: 'read',
    confirmation: 'never', requiresForeground: true,
    requiredPermissions: [calendar ? 'calendar-read-once' : contact ? 'contacts-read-selected' : name === 'mobile.camera.capture' ? 'camera-capture-once' : 'file-read'],
    timeoutMs: 120000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: [calendar || contact ? 'json' : 'file'],
  };
}
