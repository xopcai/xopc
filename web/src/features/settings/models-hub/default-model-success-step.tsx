import type { ModelSetupUse } from '@xopcai/gateway-contract';
import { ProviderSetupPanel } from './provider-setup-panel';
import type { DefaultModelTarget } from './default-model-candidates';

/** Model additions share the same preview and application engine as new connections. */
export function DefaultModelSuccessStep({ target, targetUse, zh, onDone, onApplied }: {
  target: DefaultModelTarget; targetUse?: ModelSetupUse; zh: boolean; onDone: () => void; onApplied?: () => void;
}) {
  return <ProviderSetupPanel key={target.providerId} providerId={target.providerId} modelIds={target.modelIds}
    targetUse={targetUse} language={zh ? 'zh' : 'en'} existingConnection onDone={onDone} onApplied={onApplied} />;
}
