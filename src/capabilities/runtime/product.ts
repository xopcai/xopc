import type { NotesService } from '../../notes/service.js';
import type { LocalAppService } from '../../local-apps/service.js';
import { registerLocalAppReadCapabilities } from '../../local-apps/capabilities/read.js';
import { registerLocalAppWriteCapabilities } from '../../local-apps/capabilities/write.js';
import { registerNoteReadCapabilities } from '../../notes/capabilities/read.js';
import { registerNoteWriteCapabilities } from '../../notes/capabilities/write.js';
import { registerTaskReadCapabilities } from '../../tasks/capabilities/read.js';
import { registerProjectReadCapabilities } from '../../projects/capabilities/read.js';
import { registerProjectWriteCapabilities, type ProjectWriteCapabilityDeps } from '../../projects/capabilities/write.js';
import { registerTaskRelationCapabilities } from '../../tasks/capabilities/relations.js';
import { registerTaskManagementCapabilities } from '../../tasks/capabilities/management.js';
import { registerTaskRunWriteCapabilities } from '../../tasks/capabilities/runs.js';
import type { AutomationService } from '../../automations/service/automation-service.js';
import { registerAutomationReadCapabilities } from '../../automations/capabilities/read.js';
import { registerAutomationWriteCapabilities } from '../../automations/capabilities/write.js';
import { registerAutomationDraftCapabilities } from '../../automations/capabilities/drafts.js';
import { registerTaskWriteCapabilities, type TaskWriteCapabilityDeps } from '../../tasks/capabilities/write.js';
import { CapabilityDispatcher, CapabilityError, type CapabilityContext } from './dispatcher.js';
import { registerSceneReadCapabilities } from '../../scenes/capabilities/read.js';
import { registerSceneWriteCapabilities } from '../../scenes/capabilities/write.js';
import type { SceneAccess } from '../../scenes/httpServices.js';
import { registerSettingsCapability } from './settings.js';
import { registerAppContextCapability } from './app-context.js';
import { registerAgentCapabilities } from '../../agent-catalog/capabilities.js';

export function createProductDispatcher(getNotes?: () => NotesService | undefined, taskWrites?: TaskWriteCapabilityDeps & ProjectWriteCapabilityDeps & {
  getAutomations?: () => AutomationService | undefined;
  getLocalApps?: () => LocalAppService | undefined;
  getSceneAccess?: (context: CapabilityContext) => SceneAccess | undefined;
}): CapabilityDispatcher {
  const dispatcher = new CapabilityDispatcher();
  registerSettingsCapability(dispatcher);
  registerAppContextCapability(dispatcher);
  registerAgentCapabilities(dispatcher);
  if (taskWrites?.getSceneAccess) {
    registerSceneReadCapabilities(dispatcher, taskWrites.getSceneAccess);
    registerSceneWriteCapabilities(dispatcher, taskWrites.getSceneAccess);
  }
  const localApps = taskWrites?.getLocalApps?.();
  if (localApps) {
    registerLocalAppReadCapabilities(dispatcher, localApps);
    registerLocalAppWriteCapabilities(dispatcher, localApps);
  }
  registerNoteReadCapabilities(dispatcher, () => {
    const notes = getNotes?.();
    if (!notes) throw new CapabilityError('UNAVAILABLE', 'Notes service is unavailable');
    return notes;
  });
  registerTaskReadCapabilities(dispatcher);
  const projects = taskWrites?.getProjects?.();
  if (projects) {
    registerProjectReadCapabilities(dispatcher, projects);
    registerProjectWriteCapabilities(dispatcher, projects, taskWrites);
  }
  const automations = taskWrites?.getAutomations?.();
  if (automations) {
    registerAutomationReadCapabilities(dispatcher, automations, projects);
    registerAutomationWriteCapabilities(dispatcher, automations, projects);
    registerAutomationDraftCapabilities(dispatcher, automations, taskWrites?.getConfig);
  }
  if (taskWrites) {
    registerTaskWriteCapabilities(dispatcher, taskWrites);
    registerTaskRelationCapabilities(dispatcher, taskWrites.wake);
    registerTaskManagementCapabilities(dispatcher, taskWrites.wake);
    registerTaskRunWriteCapabilities(dispatcher, taskWrites.wake);
  }
  if (getNotes) registerNoteWriteCapabilities(dispatcher, {
    getNotes: () => {
      const notes = getNotes();
      if (!notes) throw new CapabilityError('UNAVAILABLE', 'Notes service is unavailable');
      return notes;
    }, getProjects: taskWrites?.getProjects,
  });
  return dispatcher;
}
