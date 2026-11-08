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
import { CapabilityDispatcher, CapabilityError } from './dispatcher.js';
import { registerSettingsCapability } from './settings.js';
import { registerAppContextCapability } from './app-context.js';
import { registerAgentCapabilities } from '../../agent-catalog/capabilities.js';
import { registerLocalAppDelegation } from '../../local-apps/capabilities/delegate.js';
import { registerAutomationProposalCapabilities } from '../../local-apps/automation-proposals.js';
import { registerLocalAppP1Capabilities, type LocalAppP1Deps } from '../../local-apps/p1-services.js';
import { FileSpaceService } from '../../files/file-service.js';

export function createProductDispatcher(getNotes?: () => NotesService | undefined, taskWrites?: TaskWriteCapabilityDeps & ProjectWriteCapabilityDeps & {
  getAutomations?: () => AutomationService | undefined;
  getLocalApps?: () => LocalAppService | undefined;
  localAppP1?: LocalAppP1Deps;
}): CapabilityDispatcher {
  const dispatcher = new CapabilityDispatcher();
  registerSettingsCapability(dispatcher);
  registerAppContextCapability(dispatcher);
  registerAgentCapabilities(dispatcher);
  registerLocalAppDelegation(dispatcher);
  registerAutomationProposalCapabilities(dispatcher);
  const p1Config = () => { const config = taskWrites?.getConfig?.(); if (!config) throw new CapabilityError('UNAVAILABLE', 'Host configuration is unavailable'); return config; };
  let files: FileSpaceService | undefined;
  registerLocalAppP1Capabilities(dispatcher, taskWrites?.localAppP1 ?? { getConfig: p1Config, getFiles: () => {
    const projects = taskWrites?.getProjects?.(); if (!projects) throw new CapabilityError('UNAVAILABLE', 'Host files are unavailable');
    return files ??= new FileSpaceService(p1Config, projects, async () => { throw new CapabilityError('UNAVAILABLE', 'Session files are unavailable'); });
  } });
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
