import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { InstallConnectorDialog } from '@/features/connectors/components/install-connector-dialog';
import { buildInitialDraft } from '@/features/connectors/components/install-connector-draft';
import { ConnectorServicePage } from '@/features/connectors/connector-service-page';
import type { ConnectorDefinition } from '@/features/connectors/connectors-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import '@/styles/globals.css';

const params = new URLSearchParams(location.search);
const toolkit = params.get('toolkit') ?? 'gmail';
document.documentElement.classList.toggle('dark', params.get('mode') === 'dark');
useLocaleStore.setState({ language: 'zh' });
window.fetch = async input => {
  const url = String(input);
  const payload = url.includes('setup-status')
    ? { mode: 'managed', configured: true, backends: [] }
    : { auth: { toolkit, mode: 'managed', managedAuthAvailable: true, requiresCustomAuthConfig: false, authConfigs: [] } };
  return new Response(JSON.stringify({ ok: true, payload }), { headers: { 'content-type': 'application/json' } });
};
const connector: ConnectorDefinition = {
  id: `composio-${toolkit}`, version: '1', displayName: toolkit === 'gmail' ? 'Gmail' : 'Airtable',
  description: 'Read and update approved Airtable bases and records.', category: 'data', kind: 'builtin', source: 'builtin',
  capabilities: ['tools'], auth: { mode: 'oauth' }, setup: {}, runtime: { type: 'composio', toolkit, role: 'toolkit' },
  ...(toolkit === 'gmail' ? { understanding: { mode: 'activity' as const, bootstrapWindowDays: 7, readOnly: true as const } } : {}),
};
function Fixture() {
  const [draft, setDraft] = useState(buildInitialDraft(connector));
  return <MemoryRouter>{params.get('stage') === 'service' ? <ConnectorServicePage />
    : <InstallConnectorDialog draft={draft} onChange={setDraft} onClose={() => {}} onInstalled={async () => {}} t={messages('zh').connectorsSettings} />}</MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
