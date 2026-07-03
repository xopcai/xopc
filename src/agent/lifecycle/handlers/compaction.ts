import { createLogger } from '../../../utils/logger.js';
import type { AgentContext } from '../../service.types.js';
import type {
  LifecycleHandler,
  LifecycleEventData,
  LLMResponsePayload,
} from '../types.js';

const logger = createLogger('Agent:LifecycleCompaction');

export interface CompactionHandlerConfig {
  minMessages: number;
  maxTokens: number;
  preserveReasoning: boolean;
  accumulateUsage: boolean;
}

export class CompactionLifecycleHandler
  implements LifecycleHandler<LLMResponsePayload>
{
  readonly name = 'CompactionLifecycleHandler';

  constructor(_config?: Partial<CompactionHandlerConfig>) {}

  async handle(
    event: LifecycleEventData<LLMResponsePayload>,
    _context: AgentContext
  ): Promise<void> {
    const { sessionKey } = event;

    // Compaction logic is handled by SessionStore, this handler just logs for now
    logger.debug({ sessionKey, messageCount: event.payload?.usage?.total }, 'Compaction lifecycle event received');
  }

}
