import type { RegistryEntry } from './types.js';

export const registry: RegistryEntry[] = [
  { id: 'cloud-cancellation-accounting', owner: 'xopc runtime', scenarios: ['cancellation'], capabilities: ['usage-accounting', 'bounded-drain'], level: 'L1', lifecycle: 'available' },
  { id: 'coding-core', owner: 'xopc harness', scenarios: ['coding'], capabilities: ['editing', 'verification'], level: 'L1', lifecycle: 'available' },
  { id: 'xopc-core', owner: 'xopc harness', scenarios: ['research', 'data', 'work'], capabilities: ['evidence', 'convergence', 'recovery'], level: 'L1', lifecycle: 'available' },
  { id: 'xopc-ledger-holdout', owner: 'xopc harness', scenarios: ['files', 'recovery'], capabilities: ['idempotency', 'recovery', 'partial-input'], level: 'L1', lifecycle: 'available' },
  { id: 'xopc-delivery-holdout', owner: 'xopc harness', scenarios: ['files', 'recovery'], capabilities: ['delivery', 'byte-integrity', 'recovery'], level: 'L1', lifecycle: 'available' },
  { id: 'xopc-agent-growth', owner: 'xopc harness', scenarios: ['coding', 'work'], capabilities: ['discovery', 'convergence'], level: 'L1', lifecycle: 'available' },
  { id: 'prompt-behavior', owner: 'xopc harness', scenarios: ['dialogue', 'work'], capabilities: ['preferences', 'continuity'], level: 'L1', lifecycle: 'available' },
  { id: 'xopc-work-v1', owner: 'xopc harness', scenarios: ['work'], capabilities: ['convergence', 'recovery', 'continuity'], level: 'L1', lifecycle: 'available' },
  { id: 'personal-delivery', owner: 'xopc Personal', scenarios: ['delegation', 'files'], capabilities: ['delivery', 'recovery', 'scope'], level: 'L0/L2', lifecycle: 'available' },
  { id: 'personal-style', owner: 'xopc Personal', scenarios: ['dialogue'], capabilities: ['preferences', 'expression'], level: 'L1', lifecycle: 'available' },
  { id: 'personal-memory', owner: 'xopc Personal', scenarios: ['continuity'], capabilities: ['learning', 'retrieval', 'forgetting'], level: 'L1/L2', lifecycle: 'available' },
  { id: 'codemode', owner: 'xopc tools', scenarios: ['data', 'research'], capabilities: ['tool-efficiency'], level: 'L1', lifecycle: 'available' },
  { id: 'conversational-setup', owner: 'xopc configuration', scenarios: ['configuration'], capabilities: ['scope', 'tool-use'], level: 'L1/L2', lifecycle: 'available' },
  { id: 'computer-use', owner: 'xopc desktop', scenarios: ['external-apps'], capabilities: ['control', 'receipts'], level: 'L2', lifecycle: 'available' },
  { id: 'startup-performance', owner: 'xopc runtime', scenarios: ['startup'], capabilities: ['latency'], level: 'L0', lifecycle: 'available' },
  { id: 'locomo', owner: 'xopc Personal', scenarios: ['continuity'], capabilities: ['memory'], level: 'L1', lifecycle: 'planned' },
];
