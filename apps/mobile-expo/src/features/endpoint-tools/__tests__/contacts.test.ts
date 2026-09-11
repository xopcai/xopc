import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  constructedIds: [] as string[],
  getDetails: vi.fn(),
  getPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getAllDetails: vi.fn(),
  presentPicker: vi.fn(),
}));

vi.mock('expo-contacts', () => {
  class Contact {
    static getAllDetails = state.getAllDetails;
    static presentPicker = state.presentPicker;
    getDetails = state.getDetails;

    constructor(id: string) {
      state.constructedIds.push(id);
    }
  }

  return {
    Contact,
    ContactField: {
      FULL_NAME: 'fullName',
      GIVEN_NAME: 'givenName',
      FAMILY_NAME: 'familyName',
      PHONES: 'phones',
      EMAILS: 'emails',
    },
    getPermissionsAsync: state.getPermissions,
    requestPermissionsAsync: state.requestPermissions,
  };
});

import { EndpointToolRegistry } from '@xopcai/endpoint-tools-client';

import { CONTACT_ENDPOINT_TOOL_DEFINITIONS } from '../modules/contacts';

const registry = new EndpointToolRegistry(CONTACT_ENDPOINT_TOOL_DEFINITIONS);
const context = {
  invocationId: 'invocation-1',
  signal: new AbortController().signal,
  reportProgress: vi.fn(),
  uploadFile: vi.fn(),
};

const fullContact = {
  id: 'contact-1',
  fullName: 'Ada Lovelace',
  givenName: 'Ada',
  familyName: 'Lovelace',
  phones: [{ id: 'phone-1', label: 'mobile', number: ' +44 20 1234 ' }],
  emails: [{ id: 'email-1', label: 'work', address: ' ada@example.com ' }],
  note: 'must not escape',
  image: 'file:///private.jpg',
};

describe('mobile contact endpoint tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.constructedIds.length = 0;
    state.getPermissions.mockResolvedValue({
      granted: true,
      canAskAgain: true,
      accessPrivileges: 'all',
    });
    state.getAllDetails.mockResolvedValue([fullContact]);
    state.getDetails.mockResolvedValue(fullContact);
  });

  it('uses the system picker as confirmation while protecting silent contact reads', () => {
    expect(registry.descriptors().map((tool) => tool.name)).toEqual([
      'mobile.contacts.pick',
      'mobile.contacts.search',
      'mobile.contacts.get',
    ]);
    expect(registry.get('mobile.contacts.pick')?.definition.descriptor).toMatchObject({
      policyId: 'personal.foreground-mediated-read',
      effect: 'read',
      confirmation: 'never',
      requiresForeground: true,
    });
    for (const name of ['mobile.contacts.search', 'mobile.contacts.get']) {
      expect(registry.get(name)?.definition.descriptor).toMatchObject({
        policyId: 'personal.foreground-read',
        effect: 'read',
        confirmation: 'always',
        requiresForeground: true,
      });
    }
  });

  it('searches by name with a bounded limit and returns only allowlisted fields', async () => {
    const result = await registry.get('mobile.contacts.search')!.definition.execute(
      { query: ' Ada ', limit: 3 },
      context,
    );

    expect(state.getAllDetails).toHaveBeenCalledWith(
      ['fullName', 'givenName', 'familyName', 'phones', 'emails'],
      { name: 'Ada', limit: 3 },
    );
    expect(result.content[0]!.type === 'json' ? result.content[0].value : null).toEqual([{
      id: 'contact-1',
      name: 'Ada Lovelace',
      phones: ['+44 20 1234'],
      emails: ['ada@example.com'],
    }]);
  });

  it('requests contact permission only when needed and rejects denial', async () => {
    state.getPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    state.requestPermissions.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      accessPrivileges: 'none',
    });

    await expect(registry.get('mobile.contacts.search')!.definition.execute(
      { query: 'Ada' },
      context,
    )).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(state.requestPermissions).toHaveBeenCalledOnce();
    expect(state.getAllDetails).not.toHaveBeenCalled();
  });

  it('uses the system picker without requesting address-book permission', async () => {
    state.presentPicker.mockResolvedValue({ getDetails: state.getDetails });
    const result = await registry.get('mobile.contacts.pick')!.definition.execute({}, context);

    expect(state.getPermissions).not.toHaveBeenCalled();
    expect(state.requestPermissions).not.toHaveBeenCalled();
    expect(result.content[0]!.type === 'json' ? result.content[0].value : null).toMatchObject({
      id: 'contact-1',
      name: 'Ada Lovelace',
    });
  });

  it('reads a single contact by an exact bounded ID', async () => {
    await registry.get('mobile.contacts.get')!.definition.execute(
      { contactId: ' contact-1 ' },
      context,
    );
    expect(state.constructedIds).toEqual(['contact-1']);
    expect(state.getDetails).toHaveBeenCalledOnce();
  });

  it('maps picker cancellation to AbortError', async () => {
    state.presentPicker.mockResolvedValue(null);
    await expect(registry.get('mobile.contacts.pick')!.definition.execute({}, context))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
