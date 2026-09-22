import {
  ProductReadContracts,
  type CapabilityDescriptor,
  type ProductReadId,
  type ProductReadInput,
  type ProductReadOutput,
} from '@xopcai/gateway-contract';

import { fetchJson } from './fetch';
import { apiUrl } from './url';

/** Discover on each call so credentials and contract revisions are never cached across identities. */
export async function readCapability<K extends ProductReadId>(id: K, input: ProductReadInput<K>): Promise<ProductReadOutput<K>> {
  const contract = ProductReadContracts[id];
  const parsed = contract.input.parse(input);
  const path = `/api/capabilities/operations/${encodeURIComponent(id)}`;
  const descriptor = await fetchJson<CapabilityDescriptor>(apiUrl(path));
  const result = await fetchJson<{ status: 'succeeded'; data: unknown }>(apiUrl(`${path}/invocations`), {
    method: 'POST',
    body: JSON.stringify({ majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, input: parsed }),
  });
  return contract.output.parse(result.data) as ProductReadOutput<K>;
}
