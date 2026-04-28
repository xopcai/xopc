import path from 'node:path';

export const DREAMING_SWEEP_TOKEN = '__xopc_memory_dreaming_sweep__';

export const DREAMING_CRON_NAME = 'Memory Dreaming - Deep Promotion';
export const DREAMING_CRON_TAG = '[managed-by=xopc.memory.dreaming]';

export const DREAMING_DIR_RELATIVE = path.join('memory', '.dreams');
export const SHORT_TERM_RECALL_STORE_RELATIVE = path.join(DREAMING_DIR_RELATIVE, 'short-term-recall.json');
export const SHORT_TERM_PROMOTION_LOCK_RELATIVE = path.join(
  DREAMING_DIR_RELATIVE,
  'short-term-promotion.lock',
);
export const DREAMING_LAST_RUN_RELATIVE = path.join(DREAMING_DIR_RELATIVE, 'last-run.json');

export const MEMORY_MD_FILENAME = 'MEMORY.md';

