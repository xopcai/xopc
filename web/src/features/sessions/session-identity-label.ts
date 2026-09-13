import { resolveSessionIdentity, type SessionIdentityInput } from '@xopcai/gateway-contract';

import type { MessageBundle } from '@/i18n/messages';

export function sessionIdentityLabel(session: SessionIdentityInput, labels: MessageBundle['sidebar']['sessionFilters']): string {
  const { source, purpose } = resolveSessionIdentity(session);
  const parts = purpose === 'chat' ? [labels.sources[source]] : [labels.purposes[purpose]];
  const sourceAddsContext = purpose !== 'chat' && source !== 'other'
    && !(purpose === 'automation' && source === 'automation')
    && !(purpose === 'system' && source === 'system');
  if (sourceAddsContext) parts.push(labels.sources[source]);
  if (purpose === 'chat' && source === 'other' && session.sourceChannel) parts.push(session.sourceChannel);
  return [...new Set(parts)].join(' · ');
}
