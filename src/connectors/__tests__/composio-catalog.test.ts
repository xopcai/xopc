import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPOSIO_AGENT_READY_TOOLKITS,
  connectorDefinitionFromComposioToolkit,
} from '../composio-catalog.js';
import { composioLogoResponse } from '../composio-logo.js';
import { COMPOSIO_CONNECTORS, scopeForComposioAction, toolkitFromComposioSlug } from '../composio.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Composio agent-ready catalog', () => {
  it('ships 31 verified toolkit contracts with stable logos', () => {
    expect(COMPOSIO_AGENT_READY_TOOLKITS).toHaveLength(31);
    for (const slug of COMPOSIO_AGENT_READY_TOOLKITS) {
      const definition = connectorDefinitionFromComposioToolkit({
        slug,
        name: slug,
        isNoAuth: false,
        connected: false,
      });
      expect(definition).toMatchObject({
        id: `composio-${slug}`,
        verificationLevel: 'verified',
        runtime: { type: 'composio', toolkit: slug, role: 'toolkit' },
        auth: { mode: 'oauth', provider: 'composio', installPhase: 'after_install' },
      });
      expect(definition.branding?.logoUrl).toMatch(/^\/connector-icons\//);
    }
  });

  it('uses local logos for core productivity connectors', () => {
    const logoById = new Map(COMPOSIO_CONNECTORS.map((definition) => [definition.id, definition.branding?.logoUrl]));

    expect(logoById.get('composio-api-key')).toBe('/connector-icons/composio.svg');
    expect(logoById.get('composio-airtable')).toBe('/connector-icons/airtable.svg');
    expect(logoById.get('composio-clickup')).toBe('/connector-icons/clickup.svg');
    expect(logoById.get('composio-gmail')).toBe('/connector-icons/gmail.svg');
    expect(logoById.get('composio-googlecalendar')).toBe('/connector-icons/google-calendar.svg');
    expect(logoById.get('composio-googledrive')).toBe('/connector-icons/google-drive.svg');
    expect(logoById.get('composio-notion')).toBe('/connector-icons/notion.svg');
  });

  it('gives every built-in Composio connector a logo', () => {
    expect(COMPOSIO_CONNECTORS).toHaveLength(COMPOSIO_AGENT_READY_TOOLKITS.length + 1);
    for (const definition of COMPOSIO_CONNECTORS) {
      expect(definition.branding?.logoUrl).toMatch(/^\/connector-icons\/[^/]+\.svg$/);
    }
  });

  it('proxies logo images with bounded public caching and content hardening', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      { headers: { 'Content-Type': 'image/svg+xml' } },
    ));

    const response = await composioLogoResponse('GitHub');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('max-age=86400');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://logos.composio.dev/api/github',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('rejects unsafe logo slugs before making an upstream request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await composioLogoResponse('../github');

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('classifies common actions conservatively across every agent-ready toolkit', () => {
    for (const toolkit of COMPOSIO_AGENT_READY_TOOLKITS) {
      const prefix = toolkit.toUpperCase();
      expect(toolkitFromComposioSlug(`${prefix}_LIST_ITEMS`)).toBe(toolkit);
      expect(scopeForComposioAction(`${prefix}_LIST_ITEMS`)).toMatchObject({ scope: 'read', curated: true });
      expect(scopeForComposioAction(`${prefix}_CREATE_ITEM`)).toMatchObject({ scope: 'write', curated: true });
      expect(scopeForComposioAction(`${prefix}_DELETE_ITEM`)).toMatchObject({ scope: 'admin', curated: true });
      expect(scopeForComposioAction(`${prefix}_DO_SOMETHING_UNRECOGNIZED`)).toMatchObject({ scope: 'write', curated: false });
    }
  });
});
