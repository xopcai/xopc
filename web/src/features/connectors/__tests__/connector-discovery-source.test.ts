import { describe, expect, it } from 'vitest';

import {
  connectorDiscoverySourceForEntry,
  DISCOVERY_SOURCE_BUILTIN,
} from '../utils/connector-discovery-source';

describe('connectorDiscoverySourceForEntry', () => {
  it('starts personal-context setup from built-in connectors', () => {
    expect(connectorDiscoverySourceForEntry('personal-context')).toBe(DISCOVERY_SOURCE_BUILTIN);
  });

  it('keeps the default connector entry on built-in connectors', () => {
    expect(connectorDiscoverySourceForEntry('default')).toBe(DISCOVERY_SOURCE_BUILTIN);
  });
});
