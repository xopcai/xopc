import { createLogger } from '../../../utils/logger.js';
import type { AgentContext } from '../../service.js';
import type {
  LifecycleHandler,
  LifecycleEventData,
  LLMResponsePayload,
} from '../types.js';

const logger = createLogger('lifecycle-compaction');

export interface CompactionHandlerConfig {
  minMessages: number;
  maxTokens: number;
  preserveReasoning: boolean;
  accumulateUsage: boolean;
}

const DEFAULT_CONFIG: CompactionHandlerConfig = {
  minMessages: 20,
  maxTokens: 8000,
  preserveReasoning: true,
  accumulateUsage: true,
};

export class CompactionLifecycleHandler
  implements LifecycleHandler<LLMResponsePayload>
{
  readonly name = 'CompactionLifecycleHandler';
  private config: CompactionHandlerConfig;

  constructor(config?: Partial<CompactionHandlerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async handle(
    event: LifecycleEventData<LLMResponsePayload>,
    _context: AgentContext
  ): Promise<void> {
    const { sessionKey } = event;

    // Compaction logic is handled by SessionStore, this handler just logs for now
    logger.debug({ sessionKey, messageCount: event.payload?.usage?.total }, 'Compaction lifecycle event received');
  }

  private shouldCompact(messageCount: number): boolean {
    return messageCount >= this.config.minMessages;
  }
}
