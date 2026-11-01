import { CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { Config } from '../../config/schema.js';
import type { ProjectService } from '../../projects/project-service.js';
import { registerAutomationReadCapabilities } from '../capabilities/read.js';
import { registerAutomationWriteCapabilities } from '../capabilities/write.js';
import { registerAutomationDraftCapabilities } from '../capabilities/drafts.js';
import type { AutomationService } from '../service/automation-service.js';

/** Keep lazy HTTP registration local to this route family without rebuilding unrelated contracts. */
export function createAutomationDispatcher(service?: AutomationService, projects?: ProjectService, getConfig?: () => Config): CapabilityDispatcher {
  const dispatcher = new CapabilityDispatcher();
  if (service) {
    registerAutomationReadCapabilities(dispatcher, service, projects);
    registerAutomationWriteCapabilities(dispatcher, service, projects);
    registerAutomationDraftCapabilities(dispatcher, service, getConfig);
  }
  return dispatcher;
}
