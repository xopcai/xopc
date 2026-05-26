export {
  SETUP_EXIT,
  type SetupAction,
  type SetupError,
  type SetupOutcome,
  type SetupRunOptions,
} from './types.js';

export {
  runSetup,
  runSetupHeadless,
  SetupValidationError,
  type SetupMutator,
  type RunSetupArgs,
} from './runner.js';

export {
  registerSetupHandler,
  getSetupHandler,
  listSetupHandlers,
  type SetupHandler,
  type SetupHandlerArgs,
  type SetupHandlerEntry,
} from './handlers.js';

export { emitOutcome, printJsonOutcome, printTextOutcome } from './output.js';
export { promptSecret, isInteractive, isPromptCancelled } from './prompts.js';

export {
  buildSetupManifest,
  getRegisteredDomains,
  registerSetupDomain,
  serializeSetupManifest,
  type SetupActionDescriptor,
  type SetupDomainDescriptor,
  type SetupFieldDescriptor,
  type SetupFieldType,
  type SetupManifest,
  type SetupTargetDescriptor,
} from './manifest.js';
