import { createRoot } from 'react-dom/client';

import { CliConnectorDialog } from '../src/features/connectors/components/cli-connector-dialog';
import type { ConnectorDefinition, ConnectorInstance } from '../src/features/connectors/connectors-api';
import { useLocaleStore } from '../src/stores/locale-store';
import '../src/styles/globals.css';

const query = new URLSearchParams(location.search);
useLocaleStore.setState({ language: query.get('lang') === 'zh' ? 'zh' : 'en' });
if (query.get('dark') === '1') document.documentElement.classList.add('dark');
const definition = { id: 'smoke', displayName: 'CLI Test', kind: 'cli', auth: { mode: 'cli' }, runtime: { type: 'cli', adapterId: 'smoke', adapterVersion: '1', binaryVersion: '1.0.0' } } as ConnectorDefinition;
const instance = { instanceId: 'smoke', connectorId: 'smoke', enabled: true, materialized: { type: 'cli', id: 'smoke', adapterId: 'smoke' } } as ConnectorInstance;
createRoot(document.getElementById('root')!).render(<CliConnectorDialog definition={definition} instance={instance} onChanged={async () => {}} onClose={() => { document.body.dataset.closed = 'true'; }} />);
