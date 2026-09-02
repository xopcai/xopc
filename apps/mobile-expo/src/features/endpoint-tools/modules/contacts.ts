import type { EndpointToolDefinition } from '@xopcai/endpoint-tools-client';
import {
  ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA,
  ENDPOINT_CONTACT_OUTPUT_SCHEMA,
} from '@xopcai/endpoint-tools-protocol';
import * as Contacts from 'expo-contacts';

const CONTACT_FIELDS = [
  Contacts.ContactField.FULL_NAME,
  Contacts.ContactField.GIVEN_NAME,
  Contacts.ContactField.FAMILY_NAME,
  Contacts.ContactField.PHONES,
  Contacts.ContactField.EMAILS,
] as const;
const MAX_RESULTS = 20;

type ContactDetails = Contacts.PartialContactDetails<typeof CONTACT_FIELDS>;

function notAllowed(message: string): Error {
  const error = new Error(message);
  error.name = 'NotAllowedError';
  return error;
}

function userCancelled(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

async function requireContactsPermission(): Promise<void> {
  let permission = await Contacts.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Contacts.requestPermissionsAsync();
  }
  if (!permission.granted || permission.accessPrivileges === 'none') {
    throw notAllowed('Contacts permission is not granted');
  }
}

function exactStringArgument(
  args: Record<string, unknown>,
  name: string,
  maxLength: number,
): string {
  if (Object.keys(args).length !== 1 || typeof args[name] !== 'string') {
    throw new TypeError(`Expected exactly one string argument: ${name}`);
  }
  const value = args[name].trim();
  if (!value || value.length > maxLength) throw new TypeError(`Invalid ${name}`);
  return value;
}

function searchArguments(args: Record<string, unknown>): { query: string; limit: number } {
  const keys = Object.keys(args);
  if (
    !keys.includes('query')
    || keys.some((key) => key !== 'query' && key !== 'limit')
    || typeof args.query !== 'string'
  ) {
    throw new TypeError('Expected query and optional limit');
  }
  const query = args.query.trim();
  const limit = args.limit ?? 10;
  if (
    !query
    || query.length > 100
    || !Number.isInteger(limit)
    || (limit as number) < 1
    || (limit as number) > MAX_RESULTS
  ) {
    throw new TypeError('Invalid contact search arguments');
  }
  return { query, limit: limit as number };
}

function presentContact(details: ContactDetails) {
  const name = details.fullName
    || [details.givenName, details.familyName].filter(Boolean).join(' ')
    || 'Unnamed contact';
  return {
    id: details.id,
    name: name.slice(0, 500),
    phones: (details.phones ?? [])
      .map((phone: { number?: string | null }) => phone.number?.trim())
      .filter((number): number is string => Boolean(number))
      .filter((number) => number.length <= 100)
      .slice(0, MAX_RESULTS),
    emails: (details.emails ?? [])
      .map((email: { address?: string | null }) => email.address?.trim())
      .filter((address): address is string => Boolean(address))
      .filter((address) => address.length <= 320)
      .slice(0, MAX_RESULTS),
  };
}

async function detailsFor(contact: Contacts.Contact): Promise<ContactDetails> {
  return contact.getDetails(CONTACT_FIELDS);
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'json' as const, value }] };
}

export const CONTACT_ENDPOINT_TOOL_DEFINITIONS: readonly EndpointToolDefinition[] = [
  {
    descriptor: {
      name: 'mobile.contacts.pick',
      title: 'Choose a contact',
      description: 'Open the system contact picker and return only the selected contact name, phone numbers, and email addresses.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: ENDPOINT_CONTACT_OUTPUT_SCHEMA,
      policyId: 'personal.foreground-read',
      sensitivity: 'personal',
      effect: 'read',
      confirmation: 'always',
      requiresForeground: true,
      requiredPermissions: ['contacts-read-selected'],
      timeoutMs: 120_000,
      maxConcurrency: 1,
      supportsCancellation: false,
      idempotent: false,
      resultKinds: ['json'],
    },
    async execute(args) {
      if (Object.keys(args).length !== 0) throw new TypeError('Expected no arguments');
      const contact = await Contacts.Contact.presentPicker();
      if (!contact) throw userCancelled('Contact selection cancelled');
      return jsonResult(presentContact(await detailsFor(contact)));
    },
  },
  {
    descriptor: {
      name: 'mobile.contacts.search',
      title: 'Search contacts',
      description: 'Search contacts by name and return at most 20 minimal contact records.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 100 },
          limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, default: 10 },
        },
      },
      outputSchema: ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA,
      policyId: 'personal.foreground-read',
      sensitivity: 'personal',
      effect: 'read',
      confirmation: 'always',
      requiresForeground: true,
      requiredPermissions: ['contacts-read'],
      timeoutMs: 30_000,
      maxConcurrency: 1,
      supportsCancellation: false,
      idempotent: true,
      resultKinds: ['json'],
    },
    async execute(args) {
      const { query, limit } = searchArguments(args);
      await requireContactsPermission();
      const contacts = await Contacts.Contact.getAllDetails(CONTACT_FIELDS, {
        name: query,
        limit,
      });
      return jsonResult(contacts.slice(0, limit).map(presentContact));
    },
  },
  {
    descriptor: {
      name: 'mobile.contacts.get',
      title: 'Read a contact',
      description: 'Read one contact by ID and return only its name, phone numbers, and email addresses.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['contactId'],
        properties: { contactId: { type: 'string', minLength: 1, maxLength: 512 } },
      },
      outputSchema: ENDPOINT_CONTACT_OUTPUT_SCHEMA,
      policyId: 'personal.foreground-read',
      sensitivity: 'personal',
      effect: 'read',
      confirmation: 'always',
      requiresForeground: true,
      requiredPermissions: ['contacts-read'],
      timeoutMs: 30_000,
      maxConcurrency: 1,
      supportsCancellation: false,
      idempotent: true,
      resultKinds: ['json'],
    },
    async execute(args) {
      const contactId = exactStringArgument(args, 'contactId', 512);
      await requireContactsPermission();
      return jsonResult(presentContact(await detailsFor(new Contacts.Contact(contactId))));
    },
  },
];
