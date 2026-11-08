import { AgentRunErrorBanner } from './agent-run-error-banner';
import type { ProviderSetupPayload } from './provider-setup-required.types';

/** Provider setup and run failures share the same product presentation. */
export function ProviderSetupRequiredCard({ payload }: { payload: ProviderSetupPayload }) {
  return <AgentRunErrorBanner errorText={JSON.stringify({ ...payload, code: payload.kind, message: payload.message ?? '' })} />;
}

export { AgentRunErrorBanner };
