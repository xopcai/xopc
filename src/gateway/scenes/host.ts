import type { DatabaseSync } from 'node:sqlite';

import type { ProductNotification } from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../../providers/index.js';
import { SceneAgentExecutor } from '../../scenes/agentExecutor.js';
import type { SceneActivation, ScenePermission, ScenePrincipal } from '../../scenes/contracts.js';
import { SceneExecutionService, type SceneReadOnlyExecutor } from '../../scenes/execution.js';
import type { SceneHttpServices } from '../../scenes/httpServices.js';
import { SceneInboxService } from '../../scenes/inbox.js';
import type { SceneMailContextProvider } from '../../scenes/mailContext.js';
import { SceneMailObservationService } from '../../scenes/mailObservations.js';
import { SceneMetrics } from '../../scenes/metrics.js';
import { SceneRepository } from '../../scenes/repository.js';
import { SceneResultNotifications } from '../../scenes/resultNotifications.js';
import { SceneRuntime } from '../../scenes/runtime.js';
import { SceneApplicationService } from '../../scenes/service.js';
import { familyPlanTemplate, mailFollowUpTemplate } from '../../scenes/templates.js';
import { SceneUserNotesProvider } from '../../scenes/userNotes.js';
import { assertSceneCutoverReady } from '../../storage/sqlite/migrations/scenes/journal.js';
import { createLogger } from '../../utils/logger.js';
import { GatewaySceneMailContext } from './mailContext.js';

const log = createLogger('Gateway:Scenes');

/** Composition root for the converted database. Never creates tables or starts an old worker. */
export class GatewaySceneHost {
  readonly http: SceneHttpServices;
  private readonly runtime: SceneRuntime;
  private readonly notifications: SceneResultNotifications;
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopped = false;

  constructor(private readonly db: DatabaseSync, input: {
    principal: ScenePrincipal;
    config: () => Config;
    publish: (type: 'notification.created', notification: ProductNotification) => void;
    executor?: SceneReadOnlyExecutor;
    mail?: SceneMailContextProvider;
    clock?: () => number;
    intervalMs?: number;
  }) {
    assertSceneCutoverReady(db);
    if (!input.principal.ownerId.trim() || !input.principal.workspaceId.trim()) throw new Error('Scene host principal is required');
    const clock = input.clock ?? Date.now;
    const repository = new SceneRepository(db);
    repository.installTemplate(mailFollowUpTemplate);
    repository.installTemplate(familyPlanTemplate);
    const mail = input.mail ?? new GatewaySceneMailContext(db, clock);
    const providers = [mail, new SceneUserNotesProvider(db, clock)];
    const authorize = (activation: SceneActivation): ScenePermission => {
      if (activation.ownerId !== input.principal.ownerId || activation.workspaceId !== input.principal.workspaceId) {
        return { accountIds: [], contextProviders: [], effectHandlers: [] };
      }
      const accountIds = mail.authorizedAccounts(activation);
      return { accountIds, contextProviders: [
        ...(activation.scope.kind === 'personal' ? ['user_notes'] : []), ...(accountIds.length ? ['mail'] : []),
      ], effectHandlers: [] };
    };
    const grant = async (activation: SceneActivation) => authorize(activation);
    const executor = input.executor ?? new SceneAgentExecutor(() => resolveModel(getDefaultModelSync(input.config())));
    this.http = { repository, mail, application: new SceneApplicationService(repository, providers, grant, clock),
      inbox: new SceneInboxService(db, clock), metrics: new SceneMetrics(db, clock) };
    this.runtime = new SceneRuntime(repository, new SceneExecutionService(repository, providers, executor, grant, clock),
      new SceneMailObservationService(repository, mail, grant, clock, 60_000), clock, input.intervalMs ?? 5000);
    this.notifications = new SceneResultNotifications(db, authorize, (event) => input.publish('notification.created', event), clock);
    this.intervalMs = input.intervalMs ?? 5000;
  }

  private readonly intervalMs: number;

  start(): void {
    if (this.stopped) throw new Error('Create a new scene host after shutdown');
    if (this.timer) return;
    assertSceneCutoverReady(this.db);
    this.runtime.start();
    const poll = () => {
      try { this.notifications.drain(); } catch (err) { log.error({ err }, 'Scene result publication failed'); }
    };
    this.timer = setInterval(poll, this.intervalMs);
    this.timer.unref();
    poll();
  }

  tick(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Scene host stopped'));
    if (this.active) return this.active;
    const work = this.runtime.tick().then(() => {
      if (!this.stopped) this.notifications.drain();
    });
    this.active = work.finally(() => { this.active = undefined; });
    return this.active;
  }

  /** Must finish before the Gateway closes SQLite or its realtime broker. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.runtime.stop();
    await this.active?.catch(() => undefined);
  }
}
