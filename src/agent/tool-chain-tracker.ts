/**
 * Tool Chain Tracker - Tracks tool call chains and execution flow
 * 
 * Based on Agent Harness theory: "Every production-grade Agent converges 
 * on this core loop: while(model returns tool calls): execute tool → 
 * capture result → append to context"
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('ToolChainTracker');

export interface ToolCallNode {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
  timestamp: number;
  children: ToolCallNode[];
  metadata?: Record<string, unknown>;
}

export interface ToolChain {
  sessionKey: string;
  startTime: number;
  endTime?: number;
  nodes: ToolCallNode[];
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalDurationMs: number;
}

export interface ToolChainTrackerConfig {
  enabled: boolean;
  maxChainsPerSession: number;
  maxNodesPerChain: number;
  trackParams: boolean;
  trackResults: boolean;
  autoPrune: boolean;
}

const DEFAULT_CONFIG: ToolChainTrackerConfig = {
  enabled: true,
  maxChainsPerSession: 10,
  maxNodesPerChain: 100,
  trackParams: true,
  trackResults: true,
  autoPrune: true,
};

export class ToolChainTracker {
  private chains: Map<string, ToolChain> = new Map();
  private currentChainId: Map<string, string> = new Map(); // sessionKey -> chainId
  private config: ToolChainTrackerConfig;

  constructor(config: Partial<ToolChainTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start a new tool chain for a session
   */
  startChain(sessionKey: string): string {
    if (!this.config.enabled) {
      return '';
    }

    const chainId = this.generateChainId(sessionKey);
    const chain: ToolChain = {
      sessionKey,
      startTime: Date.now(),
      nodes: [],
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalDurationMs: 0,
    };

    this.chains.set(chainId, chain);
    this.currentChainId.set(sessionKey, chainId);

    log.debug({ sessionKey, chainId }, 'Started new tool chain');
    return chainId;
  }

  /**
   * Record a tool call in the chain
   */
  recordCall(
    sessionKey: string,
    toolName: string,
    params: Record<string, unknown>,
    durationMs: number = 0
  ): string {
    if (!this.config.enabled) {
      return '';
    }

    const chainId = this.currentChainId.get(sessionKey);
    if (!chainId) {
      log.warn({ sessionKey }, 'No active chain for session');
      return '';
    }

    const chain = this.chains.get(chainId);
    if (!chain) {
      log.warn({ chainId }, 'Chain not found');
      return '';
    }

    const nodeId = this.generateNodeId();
    const node: ToolCallNode = {
      id: nodeId,
      toolName,
      params: this.config.trackParams ? { ...params } : {},
      result: undefined,
      error: undefined,
      durationMs,
      timestamp: Date.now(),
      children: [],
    };

    // Prune if exceeds max nodes
    if (chain.nodes.length >= this.config.maxNodesPerChain && this.config.autoPrune) {
      this.pruneChain(chain);
    }

    chain.nodes.push(node);
    chain.totalCalls++;

    log.debug({ chainId, nodeId, toolName }, 'Recorded tool call');
    return nodeId;
  }

  /**
   * Record tool call result
   */
  recordResult(
    sessionKey: string,
    nodeId: string,
    result?: unknown,
    error?: string,
    durationMs?: number
  ): void {
    if (!this.config.enabled) {
      return;
    }

    const chainId = this.currentChainId.get(sessionKey);
    if (!chainId) return;

    const chain = this.chains.get(chainId);
    if (!chain) return;

    const node = chain.nodes.find(n => n.id === nodeId);
    if (!node) {
      log.warn({ nodeId }, 'Tool call node not found');
      return;
    }

    if (this.config.trackResults && result) {
      node.result = result;
    }

    if (error) {
      node.error = error;
      chain.failedCalls++;
    } else {
      chain.successfulCalls++;
    }

    if (durationMs !== undefined) {
      node.durationMs = durationMs;
      chain.totalDurationMs += durationMs;
    }

    log.debug({ nodeId, error: !!error }, 'Recorded tool result');
  }

  /**
   * End the current chain for a session
   */
  endChain(sessionKey: string): void {
    const chainId = this.currentChainId.get(sessionKey);
    if (!chainId) return;

    const chain = this.chains.get(chainId);
    if (chain) {
      chain.endTime = Date.now();
      log.info(
        {
          chainId,
          totalCalls: chain.totalCalls,
          successRate: this.calculateSuccessRate(chain),
          duration: chain.endTime - chain.startTime,
        },
        'Tool chain ended'
      );
    }

    this.currentChainId.delete(sessionKey);

    // Auto-prune old chains
    if (this.config.autoPrune) {
      this.pruneOldChains(sessionKey);
    }
  }

  /**
   * Get chain summary as text
   */
  getChainSummary(sessionKey: string): string {
    const chainId = this.currentChainId.get(sessionKey);
    if (!chainId) {
      return 'No active tool chain';
    }

    const chain = this.chains.get(chainId);
    if (!chain) {
      return 'Chain not found';
    }

    const lines: string[] = [
      `Tool Chain Summary (Chain: ${chainId})`,
      `================================`,
      `Session: ${sessionKey}`,
      `Status: ${chain.endTime ? 'Completed' : 'Active'}`,
      `Duration: ${chain.endTime ? ((chain.endTime - chain.startTime) / 1000).toFixed(1) : 'Ongoing'}s`,
      '',
      `Total Calls: ${chain.totalCalls}`,
      `Successful: ${chain.successfulCalls}`,
      `Failed: ${chain.failedCalls}`,
      `Success Rate: ${this.calculateSuccessRate(chain).toFixed(1)}%`,
      `Avg Duration: ${chain.totalCalls > 0 ? (chain.totalDurationMs / chain.totalCalls).toFixed(0) : 0}ms`,
      '',
      'Tool Calls:',
    ];

    for (const node of chain.nodes) {
      const status = node.error ? '❌' : '✅';
      lines.push(`  ${status} ${node.toolName}(${JSON.stringify(node.params).slice(0, 50)}...)`);
    }

    return lines.join('\n');
  }

  /**
   * Get chain visualization (ASCII tree)
   */
  getChainVisualization(sessionKey: string): string {
    const chainId = this.currentChainId.get(sessionKey);
    if (!chainId) return 'No active chain';

    const chain = this.chains.get(chainId);
    if (!chain) return 'Chain not found';

    const lines: string[] = [`Tool Chain: ${chainId}`, ''];

    chain.nodes.forEach((node, index) => {
      const prefix = index === chain.nodes.length - 1 ? '└─' : '├─';
      const status = node.error ? '❌' : '✅';
      lines.push(`${prefix} ${status} ${node.toolName} (${node.durationMs}ms)`);
      
      if (node.error) {
        lines.push(`   └─ Error: ${node.error.slice(0, 100)}...`);
      }
    });

    return lines.join('\n');
  }

  /**
   * Get all chains for a session
   */
  getSessionChains(sessionKey: string): ToolChain[] {
    return Array.from(this.chains.values())
      .filter(chain => chain.sessionKey === sessionKey);
  }

  /**
   * Get current active chain
   */
  getCurrentChain(sessionKey: string): ToolChain | undefined {
    const chainId = this.currentChainId.get(sessionKey);
    if (!chainId) return undefined;
    return this.chains.get(chainId);
  }

  /**
   * Get chain statistics
   */
  getStats(): {
    totalChains: number;
    activeChains: number;
    totalToolCalls: number;
    avgSuccessRate: number;
  } {
    const chains = Array.from(this.chains.values());
    const activeChains = chains.filter(c => !c.endTime);
    const completedChains = chains.filter(c => c.endTime);

    const avgSuccessRate = completedChains.length > 0
      ? completedChains.reduce((sum, c) => sum + this.calculateSuccessRate(c), 0) / completedChains.length
      : 0;

    return {
      totalChains: chains.length,
      activeChains: activeChains.length,
      totalToolCalls: chains.reduce((sum, c) => sum + c.totalCalls, 0),
      avgSuccessRate,
    };
  }

  /**
   * Export chains as JSON
   */
  exportChains(sessionKey?: string): string {
    let chains = Array.from(this.chains.values());
    
    if (sessionKey) {
      chains = chains.filter(c => c.sessionKey === sessionKey);
    }

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      totalChains: chains.length,
      chains: chains.map(c => ({
        ...c,
        nodes: c.nodes.map(n => ({
          ...n,
          // Omit large result data for export
          result: this.config.trackResults ? '[omitted]' : undefined,
        })),
      })),
    }, null, 2);
  }

  /**
   * Reset all chains
   */
  reset(): void {
    this.chains.clear();
    this.currentChainId.clear();
    log.info('Tool chain tracker reset');
  }

  /**
   * Get config
   */
  getConfig(): ToolChainTrackerConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  setConfig(config: Partial<ToolChainTrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateChainId(sessionKey: string): string {
    return `${sessionKey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateNodeId(): string {
    return `node-${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateSuccessRate(chain: ToolChain): number {
    if (chain.totalCalls === 0) return 0;
    return (chain.successfulCalls / chain.totalCalls) * 100;
  }

  private pruneChain(chain: ToolChain): void {
    // Keep only the most recent nodes
    const nodesToKeep = Math.floor(this.config.maxNodesPerChain * 0.5);
    const nodesToRemove = chain.nodes.length - nodesToKeep;
    
    if (nodesToRemove > 0) {
      chain.nodes = chain.nodes.slice(-nodesToKeep);
      log.debug({ removed: nodesToRemove }, 'Pruned old nodes from chain');
    }
  }

  private pruneOldChains(sessionKey: string): void {
    const sessionChains = this.getSessionChains(sessionKey);
    
    if (sessionChains.length > this.config.maxChainsPerSession) {
      // Sort by start time and remove oldest
      sessionChains.sort((a, b) => a.startTime - b.startTime);
      const chainsToRemove = sessionChains.slice(0, sessionChains.length - this.config.maxChainsPerSession);
      
      for (const chain of chainsToRemove) {
        const chainId = Array.from(this.chains.entries())
          .find(([_, c]) => c === chain)?.[0];
        
        if (chainId) {
          this.chains.delete(chainId);
        }
      }
      
      log.debug({ removed: chainsToRemove.length }, 'Pruned old chains');
    }
  }
}
