/**
 * Tool Usage Analyzer - Tracks and analyzes tool usage patterns
 * 
 * Based on Agent Harness theory: "Vercel deleted 80% of its Agent tools, 
 * and the Agent went from task failure to task success"
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('ToolUsageAnalyzer');

export interface ToolUsageStats {
  toolName: string;
  calls: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  lastUsedTimestamp: number;
  successRate: number;
}

export interface ToolUsageRecommendations {
  keep: string[];      // High-usage, high-success tools
  review: string[];    // Low-usage or low-success tools
  remove: string[];    // Very low-usage tools
}

export interface ToolUsageAnalyzerConfig {
  enabled: boolean;
  lowUsageThreshold: number;     // Below this % = low usage (default: 5%)
  veryLowUsageThreshold: number; // Below this % = very low usage (default: 1%)
  minCallsForAnalysis: number;   // Minimum calls before making recommendations (default: 100)
  reportIntervalMs: number;      // How often to log reports (default: 1 hour)
}

const DEFAULT_CONFIG: ToolUsageAnalyzerConfig = {
  enabled: true,
  lowUsageThreshold: 5,      // 5%
  veryLowUsageThreshold: 1,  // 1%
  minCallsForAnalysis: 100,
  reportIntervalMs: 60 * 60 * 1000, // 1 hour
};

export class ToolUsageAnalyzer {
  private stats: Map<string, ToolUsageStats> = new Map();
  private config: ToolUsageAnalyzerConfig;
  private totalCalls = 0;
  private lastReportTime = 0;

  constructor(config: Partial<ToolUsageAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a tool usage event
   */
  recordUsage(
    toolName: string,
    success: boolean,
    durationMs: number
  ): void {
    if (!this.config.enabled) return;

    const now = Date.now();
    let toolStats = this.stats.get(toolName);

    if (!toolStats) {
      toolStats = {
        toolName,
        calls: 0,
        successes: 0,
        failures: 0,
        avgDurationMs: 0,
        lastUsedTimestamp: 0,
        successRate: 0,
      };
      this.stats.set(toolName, toolStats);
    }

    // Update stats
    toolStats.calls++;
    toolStats.lastUsedTimestamp = now;
    
    if (success) {
      toolStats.successes++;
    } else {
      toolStats.failures++;
    }

    // Update average duration (running average)
    toolStats.avgDurationMs = 
      ((toolStats.avgDurationMs * (toolStats.calls - 1)) + durationMs) / toolStats.calls;
    
    // Update success rate
    toolStats.successRate = (toolStats.successes / toolStats.calls) * 100;

    this.totalCalls++;

    // Periodic report
    if (now - this.lastReportTime > this.config.reportIntervalMs) {
      this.generateReport();
      this.lastReportTime = now;
    }
  }

  /**
   * Get usage stats for a specific tool
   */
  getToolStats(toolName: string): ToolUsageStats | undefined {
    return this.stats.get(toolName);
  }

  /**
   * Get all tool usage stats
   */
  getAllStats(): Map<string, ToolUsageStats> {
    return new Map(this.stats);
  }

  /**
   * Get tools with low usage (below threshold)
   */
  getLowUsageTools(threshold?: number): string[] {
    const thresholdPercent = threshold ?? this.config.lowUsageThreshold;
    const lowUsageTools: string[] = [];

    for (const [name, stats] of this.stats.entries()) {
      const usagePercent = (stats.calls / this.totalCalls) * 100;
      if (usagePercent < thresholdPercent && stats.calls >= this.config.minCallsForAnalysis) {
        lowUsageTools.push(name);
      }
    }

    return lowUsageTools;
  }

  /**
   * Get tools with low success rate
   */
  getLowSuccessTools(threshold?: number): string[] {
    const thresholdPercent = threshold ?? 50; // Default 50% success rate
    const lowSuccessTools: string[] = [];

    for (const [name, stats] of this.stats.entries()) {
      if (stats.successRate < thresholdPercent && stats.calls >= this.config.minCallsForAnalysis) {
        lowSuccessTools.push(name);
      }
    }

    return lowSuccessTools;
  }

  /**
   * Get recommendations for tool optimization
   */
  getRecommendations(): ToolUsageRecommendations {
    const recommendations: ToolUsageRecommendations = {
      keep: [],
      review: [],
      remove: [],
    };

    if (this.totalCalls < this.config.minCallsForAnalysis) {
      log.warn({ totalCalls: this.totalCalls }, 'Not enough data for recommendations');
      return recommendations;
    }

    for (const [name, stats] of this.stats.entries()) {
      const usagePercent = (stats.calls / this.totalCalls) * 100;
      
      // High usage + high success = keep
      if (usagePercent >= this.config.lowUsageThreshold && stats.successRate >= 80) {
        recommendations.keep.push(name);
      }
      // Very low usage = consider removing
      else if (usagePercent < this.config.veryLowUsageThreshold) {
        recommendations.remove.push(name);
      }
      // Low usage OR low success = review
      else if (
        usagePercent < this.config.lowUsageThreshold || 
        stats.successRate < 80
      ) {
        recommendations.review.push(name);
      }
      // Default = keep
      else {
        recommendations.keep.push(name);
      }
    }

    return recommendations;
  }

  /**
   * Generate and log usage report
   */
  generateReport(): void {
    if (!this.config.enabled) return;

    const report = {
      totalCalls: this.totalCalls,
      uniqueTools: this.stats.size,
      topTools: this.getTopTools(5),
      lowUsageTools: this.getLowUsageTools(),
      lowSuccessTools: this.getLowSuccessTools(),
      recommendations: this.getRecommendations(),
    };

    log.info(report, 'Tool Usage Report');
  }

  /**
   * Get top N most used tools
   */
  getTopTools(n: number): ToolUsageStats[] {
    return Array.from(this.stats.values())
      .sort((a, b) => b.calls - a.calls)
      .slice(0, n);
  }

  /**
   * Get usage summary as text
   */
  getSummaryText(): string {
    const lines: string[] = [
      'Tool Usage Summary',
      `==================`,
      `Total Calls: ${this.totalCalls}`,
      `Unique Tools: ${this.stats.size}`,
      '',
      'Top Tools:',
    ];

    const topTools = this.getTopTools(5);
    for (const tool of topTools) {
      lines.push(`  - ${tool.toolName}: ${tool.calls} calls (${tool.successRate.toFixed(1)}% success)`);
    }

    const recommendations = this.getRecommendations();
    
    if (recommendations.remove.length > 0) {
      lines.push('');
      lines.push('Consider Removing:');
      for (const tool of recommendations.remove) {
        lines.push(`  - ${tool}`);
      }
    }

    if (recommendations.review.length > 0) {
      lines.push('');
      lines.push('Review Needed:');
      for (const tool of recommendations.review) {
        lines.push(`  - ${tool}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Reset all stats
   */
  reset(): void {
    this.stats.clear();
    this.totalCalls = 0;
    this.lastReportTime = 0;
    log.info('Tool usage stats reset');
  }

  /**
   * Export stats as JSON
   */
  exportStats(): string {
    return JSON.stringify({
      totalCalls: this.totalCalls,
      generatedAt: new Date().toISOString(),
      tools: Array.from(this.stats.values()),
      recommendations: this.getRecommendations(),
    }, null, 2);
  }

  /**
   * Get config
   */
  getConfig(): ToolUsageAnalyzerConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  setConfig(config: Partial<ToolUsageAnalyzerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
