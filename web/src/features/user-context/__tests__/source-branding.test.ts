import { describe, expect, it } from 'vitest';

import { personalContextSourceBranding } from '../source-branding';

describe('personalContextSourceBranding', () => {
  it.each([
    ['composio-gmail', '/connector-icons/gmail.svg'],
    ['composio-googledrive', '/connector-icons/google-drive.svg'],
    ['composio-notion', '/connector-icons/notion.svg'],
    ['composio-slack', '/connector-icons/slack.svg'],
    ['memory', '/connector-icons/memory.svg'],
  ])('maps %s to its local icon', (id, logoUrl) => {
    expect(personalContextSourceBranding({ id })).toEqual({ logoUrl });
  });

  it('prefers branding supplied by the connector catalog', () => {
    const branding = { logoUrl: '/custom.svg', backgroundColor: '#fff' };
    expect(personalContextSourceBranding({ id: 'composio-gmail', branding })).toBe(branding);
  });
});
