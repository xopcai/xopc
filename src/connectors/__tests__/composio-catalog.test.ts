import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPOSIO_AGENT_READY_TOOLKITS,
  connectorDefinitionFromComposioToolkit,
} from '../composio-catalog.js';
import { composioLogoResponse } from '../composio-logo.js';
import {
  COMPOSIO_CONNECTORS,
  isComposioActionAllowedByCatalog,
  scopeForComposioAction,
  toolkitFromComposioSlug,
} from '../composio.js';

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
        source: 'registry',
        verificationLevel: 'verified',
        runtime: { type: 'composio', toolkit: slug, role: 'toolkit' },
        auth: { mode: 'oauth', provider: 'composio' },
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

  it('keeps native channels separate and uses Composio for GitHub', () => {
    const strategyById = new Map(COMPOSIO_CONNECTORS.map((definition) => [definition.id, definition.integrationStrategy]));

    expect(strategyById.get('composio-telegram')).toEqual({
      lane: 'native',
      workload: 'core',
      preferred: false,
      alternative: { kind: 'channel', id: 'telegram' },
    });
    expect(strategyById.get('composio-github')).toEqual({
      lane: 'composio',
      workload: 'core',
      preferred: true,
    });
    expect(strategyById.get('composio-notion')).toEqual({
      lane: 'composio',
      workload: 'core',
      preferred: true,
    });
  });

  it('marks first-phase understanding sources as personal context', () => {
    for (const slug of [
      'gmail', 'googlecalendar', 'googledrive', 'googledocs', 'googlesheets', 'notion', 'slack', 'github', 'linear', 'jira',
      'outlook', 'microsoft_teams', 'one_drive', 'excel',
    ]) {
      const definition = connectorDefinitionFromComposioToolkit({
        slug,
        name: slug,
        isNoAuth: false,
        connected: false,
      });
      expect(definition.capabilities).toEqual(expect.arrayContaining(['context', 'memory_source']));
    }
  });

  it('describes user benefits explicitly and allows one app in multiple filters', () => {
    const gmail = connectorDefinitionFromComposioToolkit({ slug: 'gmail', name: 'Gmail', isNoAuth: false, connected: false });
    const github = connectorDefinitionFromComposioToolkit({ slug: 'github', name: 'GitHub', isNoAuth: false, connected: false });
    const todoist = connectorDefinitionFromComposioToolkit({ slug: 'todoist', name: 'Todoist', isNoAuth: false, connected: false });

    expect(gmail.benefits).toEqual(['understand', 'act', 'reach']);
    expect(github.benefits).toEqual(['understand', 'act']);
    expect(todoist.benefits).toEqual(['act']);
  });

  it('gives every built-in Composio connector a logo', () => {
    expect(COMPOSIO_CONNECTORS).toHaveLength(COMPOSIO_AGENT_READY_TOOLKITS.length + 1);
    for (const definition of COMPOSIO_CONNECTORS) {
      expect(definition.source).toBe('builtin');
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
      if (toolkit === 'github') {
        expect(scopeForComposioAction(`${prefix}_LIST_ITEMS`)).toMatchObject({ curated: false });
        expect(scopeForComposioAction(`${prefix}_CREATE_ITEM`)).toMatchObject({ curated: false });
        expect(scopeForComposioAction(`${prefix}_DELETE_ITEM`)).toMatchObject({ curated: false });
      } else {
        expect(scopeForComposioAction(`${prefix}_LIST_ITEMS`)).toMatchObject({ scope: 'read', curated: true });
        expect(scopeForComposioAction(`${prefix}_CREATE_ITEM`)).toMatchObject({ scope: 'write', curated: true });
        expect(scopeForComposioAction(`${prefix}_DELETE_ITEM`)).toMatchObject({ scope: 'admin', curated: true });
      }
      expect(scopeForComposioAction(`${prefix}_DO_SOMETHING_UNRECOGNIZED`)).toMatchObject({ scope: 'write', curated: false });
    }
  });

  it('matches OpenHuman GitHub curation and rejects uncurated GitHub actions', () => {
    expect(scopeForComposioAction('GITHUB_GET_THE_AUTHENTICATED_USER')).toEqual({
      toolkit: 'github',
      scope: 'read',
      curated: true,
    });
    expect(scopeForComposioAction('GITHUB_MERGE_A_PULL_REQUEST')).toEqual({
      toolkit: 'github',
      scope: 'write',
      curated: true,
    });
    expect(scopeForComposioAction('GITHUB_DELETE_A_REPOSITORY')).toEqual({
      toolkit: 'github',
      scope: 'admin',
      curated: true,
    });
    expect(scopeForComposioAction('GITHUB_LIST_WORKFLOWS')).toEqual({
      toolkit: 'github',
      scope: 'write',
      curated: false,
    });
    expect(isComposioActionAllowedByCatalog('GITHUB_GET_AN_ISSUE')).toBe(true);
    expect(isComposioActionAllowedByCatalog('GITHUB_LIST_WORKFLOWS')).toBe(false);
  });
});
