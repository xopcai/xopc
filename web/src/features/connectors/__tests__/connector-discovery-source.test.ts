import { describe, expect, it } from 'vitest';

import {
  connectorDiscoverySourceForEntry,
  DISCOVERY_SOURCE_BUILTIN,
  DISCOVERY_SOURCE_RECOMMENDED,
} from '../utils/connector-discovery-source';

describe('connectorDiscoverySourceForEntry', () => {
  it('starts Chinese discovery with Store recommendations while keeping understanding setup explicit', () => {
    expect(connectorDiscoverySourceForEntry('default', 'zh')).toBe(DISCOVERY_SOURCE_RECOMMENDED);
    expect(connectorDiscoverySourceForEntry('understanding', 'zh')).toBe(DISCOVERY_SOURCE_BUILTIN);
  });
  it('starts understanding setup from built-in connectors', () => {
    expect(connectorDiscoverySourceForEntry('understanding')).toBe(DISCOVERY_SOURCE_BUILTIN);
  });

  it('keeps the default connector entry on built-in connectors', () => {
    expect(connectorDiscoverySourceForEntry('default')).toBe(DISCOVERY_SOURCE_BUILTIN);
  });
});
