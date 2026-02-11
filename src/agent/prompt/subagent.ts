// SubAgent Management - Spawn and manage sub-agent sessions
import { v4 as uuidv4 } from 'crypto';

// =============================================================================
// Types
// =============================================================================

export interface SubAgentConfig {
  task: string;
  model?: string;
  timeout?: number;
  label?: string;
  parentSession?: string;
}

export interface SubAgentResult {
  sessionKey: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface SubAgentRegistry {
  [sessionKey: string]: SubAgentResult;
}

// =============================================================================
// Session Key Generator
// =============================================================================

export function generateSessionKey(prefix: string = 'subagent'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

export function parseSessionKey(key: string): {
  prefix: string;
  timestamp: number;
  random: string;
} | null {
  const match = key.match(/^([a-z]+)-(\d+)-([a-z0-9]+)$/);
  if (!match) return null;
  
  return {
    prefix: match[1],
    timestamp: parseInt(match[2], 10),
    random: match[3],
  };
}

// =============================================================================
// SubAgent Registry (In-Memory)
// =============================================================================

class SubAgentRegistryImpl implements SubAgentRegistry {
  private registry: Map<string, SubAgentResult> = new Map();
  private maxAge: number = 24 * 60 * 60 * 1000; // 24 hours

  register(config: SubAgentConfig): SubAgentResult {
    const sessionKey = generateSessionKey('subagent');
    
    const result: SubAgentResult = {
      sessionKey,
      task: config.task,
      status: 'pending',
      createdAt: new Date(),
    };
    
    this.registry.set(sessionKey, result);
    this.cleanup();
    
    return result;
  }

  update(sessionKey: string, updates: Partial<SubAgentResult>): boolean {
    const existing = this.registry.get(sessionKey);
    if (!existing) return false;
    
    const updated = { ...existing, ...updates };
    this.registry.set(sessionKey, updated);
    return true;
  }

  get(sessionKey: string): SubAgentResult | undefined {
    return this.registry.get(sessionKey);
  }

  list(): SubAgentResult[] {
    this.cleanup();
    return Array.from(this.registry.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  listByPrefix(prefix: string): SubAgentResult[] {
    this.cleanup();
    return Array.from(this.registry.values())
      .filter(r => r.sessionKey.startsWith(prefix))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  delete(sessionKey: string): boolean {
    return this.registry.delete(sessionKey);
  }

  clear(): void {
    this.registry.clear();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.maxAge;
    for (const [key, value] of this.registry) {
      if (value.createdAt.getTime() < cutoff) {
        this.registry.delete(key);
      }
    }
  }
}

// Singleton instance
export const subAgentRegistry = new SubAgentRegistryImpl();

// =============================================================================
// SubAgent Builder
// =============================================================================

export class SubAgentBuilder {
  private task: string = '';
  private model?: string;
  private timeout?: number;
  private label?: string;
  private parentSession?: string;
  private tags: string[] = [];
  private priority: 'low' | 'normal' | 'high' = 'normal';

  setTask(task: string): this {
    this.task = task;
    return this;
  }

  setModel(model: string): this {
    this.model = model;
    return this;
  }

  setTimeout(seconds: number): this {
    this.timeout = seconds;
    return this;
  }

  setLabel(label: string): this {
    this.label = label;
    return this;
  }

  setParentSession(sessionKey: string): this {
    this.parentSession = sessionKey;
    return this;
  }

  addTag(tag: string): this {
    this.tags.push(tag);
    return this;
  }

  setPriority(priority: 'low' | 'normal' | 'high'): this {
    this.priority = priority;
    return this;
  }

  build(): SubAgentConfig {
    return {
      task: this.task,
      model: this.model,
      timeout: this.timeout,
      label: this.label,
      parentSession: this.parentSession,
    };
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create a new sub-agent builder
 */
export function createSubAgent(): SubAgentBuilder {
  return new SubAgentBuilder();
}

/**
 * Register a new sub-agent
 */
export function spawnSubAgent(config: SubAgentConfig): SubAgentResult {
  return subAgentRegistry.register(config);
}

/**
 * Get sub-agent status
 */
export function getSubAgentStatus(sessionKey: string): SubAgentResult | undefined {
  return subAgentRegistry.get(sessionKey);
}

/**
 * List all sub-agents
 */
export function listSubAgents(): SubAgentResult[] {
  return subAgentRegistry.list();
}

/**
 * Update sub-agent status
 */
export function updateSubAgent(
  sessionKey: string, 
  status: SubAgentResult['status'],
  result?: string,
  error?: string
): boolean {
  const updates: Partial<SubAgentResult> = { status };
  
  if (result !== undefined) updates.result = result;
  if (error !== undefined) updates.error = error;
  if (status === 'completed' || status === 'failed') {
    updates.completedAt = new Date();
  }
  
  return subAgentRegistry.update(sessionKey, updates);
}

/**
 * Wait for sub-agent to complete
 */
export async function waitForSubAgent(
  sessionKey: string,
  timeout?: number
): Promise<SubAgentResult> {
  const startTime = Date.now();
  const maxWait = timeout || 300000; // 5 minutes default
  
  while (Date.now() - startTime < maxWait) {
    const status = subAgentRegistry.get(sessionKey);
    if (!status) {
      throw new Error(`Sub-agent ${sessionKey} not found`);
    }
    
    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error(`Sub-agent ${sessionKey} timed out`);
}

/**
 * Cancel a sub-agent
 */
export function cancelSubAgent(sessionKey: string): boolean {
  return subAgentRegistry.delete(sessionKey);
}

/**
 * Format sub-agent for display
 */
export function formatSubAgentForDisplay(result: SubAgentResult): string {
  const lines = [
    `Session: ${result.sessionKey}`,
    `Task: ${result.task}`,
    `Status: ${result.status}`,
    `Created: ${result.createdAt.toISOString()}`,
  ];
  
  if (result.completedAt) {
    lines.push(`Completed: ${result.completedAt.toISOString()}`);
  }
  
  if (result.result) {
    lines.push(`Result: ${result.result}`);
  }
  
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }
  
  return lines.join('\n');
}
