import { pendingTranscriptReferencesMediaUri } from '../agent/inbound/attachment-pipeline.js';
import { FileServiceError } from '../files/file-service.js';
import { resolveMediaReference } from '../media/media-reference.js';
import { messagesReferenceMediaUri } from '../media/session-references.js';
import { TaskContextRepository } from '../tasks/task-context-repository.js';
import { TaskRepository } from '../tasks/task-repository.js';
import type { GatewayService } from './service.js';

/** Resolve media only when the supplied session or task references it. */
export async function resolveScopedMediaReference(
  service: GatewayService,
  uri: string,
  scope: { sessionKey?: string; taskId?: string },
) {
  const { sessionKey, taskId } = scope;
  if (!sessionKey && !taskId) throw new FileServiceError(400, 'Missing media scope');
  const media = await resolveMediaReference(uri);
  const sessionReferencesUri = sessionKey
    ? messagesReferenceMediaUri(await service.sessionIndexInstance.loadMessages(sessionKey), media.uri)
      || pendingTranscriptReferencesMediaUri(sessionKey, media.uri)
    : false;
  const taskReferencesUri = taskId && new TaskRepository().get(taskId)
    ? new TaskContextRepository().list(taskId)
      .some((edge) => edge.targetKind === 'file' && edge.targetId === media.uri)
    : false;
  if (!sessionReferencesUri && !taskReferencesUri) throw new FileServiceError(404, 'Not found');
  return media;
}
