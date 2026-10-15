import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomMcpServerDialog } from '@/features/connectors/custom-mcp-server-dialog';
import { emptyMcpServerRow, normalizeMcpSettingsFromConfig } from '@/features/connectors/mcp/mcp-config-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import '@/styles/globals.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const stage = params.get('stage') ?? 'default';
const m = messages(language);
useLocaleStore.setState({ language });
document.documentElement.lang = language;
document.documentElement.classList.toggle('dark', params.get('mode') === 'dark');
const reference = { xopcSecretRef: { provider: 'vault', fieldKey: 'apiKey' } };
const configs: Record<string, Record<string, unknown>> = {
  bearer: { url: 'https://docs.example.com/mcp', headers: { Authorization: 'Bearer fixture-token' } },
  headers: { url: 'https://docs.example.com/mcp', headers: { 'X-Custom-Key': 'fixture-token', 'X-Tenant': 'team' } },
  command: { command: 'node', args: ['server.js', 'C:\\folder with spaces'], env: { API_KEY: reference } },
  reference: { url: 'https://docs.example.com/mcp', auth: { provider: 'vendor' }, headers: { Authorization: reference } },
  disabled: { url: 'https://docs.example.com/mcp', enabled: false, displayName: 'Team knowledge / 团队知识库' },
};
const row = stage in configs ? normalizeMcpSettingsFromConfig({ mcp: { servers: { docs: configs[stage] } } }).servers[0] : emptyMcpServerRow();
let cancelled = false;
const requests: string[] = [];
Object.assign(window, { mcpFixtureRequests: requests });
window.fetch = async (input, init) => {
  const url = String(input); requests.push(`${init?.method ?? 'GET'} ${url}`);
  const payload = url.endsWith('/drafts') ? { id: 'fixture-draft', serverId: 'docs', expiresAt: Date.now() + 600_000 } : url.endsWith('/probe') ? stage === 'error' ? { state: 'error', error: 'fixture connection unavailable' } : stage === 'oauth' ? { state: 'oauth_required' } : { state: 'connected', toolCount: 8 }
    : url.endsWith('/commit') ? { serverId: 'docs', ...(stage === 'reload' ? { reloadRequired: true } : {}) }
    : url.endsWith('/auth') ? init?.method === 'POST' ? { id: 'fixture-auth', state: 'starting', serverId: 'docs' } : { id: 'fixture-auth', state: cancelled ? 'cancelled' : 'authorizing', acceptsRedirect: true, serverId: 'docs', authorizationUrl: 'https://example.com/authorize' }
    : url.includes('/auth/fixture-auth') ? { id: 'fixture-auth', state: cancelled ? 'cancelled' : 'authorizing', acceptsRedirect: true, serverId: 'docs', authorizationUrl: 'https://example.com/authorize' }
    : url.endsWith('/tools') ? { tools: [{ name: 'lookup', description: 'Find a note', inputSchema: { type: 'object' } }] } : {};
  if (init?.method === 'DELETE') cancelled = true;
  return new Response(JSON.stringify({ ok: true, payload }), { headers: { 'content-type': 'application/json' } });
};
function Fixture() {
  const [open, setOpen] = useState(true);
  return open ? <CustomMcpServerDialog open mode={stage in configs ? 'edit' : 'add'} initialRow={row}
  existingCustomServers={stage in configs ? [row] : []} managedServerIds={new Set()} config={{}} t={m.mcpSettings} cs={m.connectorsSettings}
  onClose={() => setOpen(false)} onSaved={async () => {}} /> : null;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
