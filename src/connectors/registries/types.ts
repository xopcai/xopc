import type { ConnectorDefinition } from '../types.js';

export type ConnectorRegistrySource = string;

export type ConnectorRegistrySearchParams = {
  query?: string;
  page?: number;
  pageSize?: number;
  source?: ConnectorRegistrySource | 'all';
  browse?: boolean;
};

export type ConnectorRegistrySearchResult = {
  source: ConnectorRegistrySource;
  connectors: ConnectorDefinition[];
  totalPages?: number;
  error?: string;
};

export type ConnectorRegistryAdapter = {
  source: ConnectorRegistrySource;
  displayName: string;
  search(params: ConnectorRegistrySearchParams): Promise<ConnectorRegistrySearchResult>;
};
