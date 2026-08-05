import { describe, it, expect } from 'vitest';
import { detectToolLoops, type RecentToolCall } from '../loop-guard.js';

describe('detectToolLoops', () => {
  it('should return no injection for empty history', () => {
    const result = detectToolLoops([]);
    expect(result.injection).toBeNull();
    expect(result.hiddenTools.size).toBe(0);
  });

  it('should return no injection for unique calls', () => {
    const calls: RecentToolCall[] = [
      { name: 'read_file', params: { path: '/a.ts' } },
      { name: 'read_file', params: { path: '/b.ts' } },
      { name: 'grep', params: { pattern: 'foo' } },
    ];
    const result = detectToolLoops(calls);
    expect(result.injection).toBeNull();
    expect(result.hiddenTools.size).toBe(0);
  });

  it('should inject soft warning at softThreshold (2 consecutive)', () => {
    const calls: RecentToolCall[] = [
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
    ];
    const result = detectToolLoops(calls);
    expect(result.injection).toContain('LOOP DETECTION');
    expect(result.injection).toContain('find');
    expect(result.injection).toContain('2 times');
    expect(result.hiddenTools.size).toBe(0);
  });

  it('should hide tool at hideThreshold (3 consecutive)', () => {
    const calls: RecentToolCall[] = [
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
    ];
    const result = detectToolLoops(calls);
    expect(result.injection).toContain('LOOP DETECTION');
    expect(result.injection).toContain('unavailable');
    expect(result.hiddenTools.has('find')).toBe(true);
  });

  it('should not trigger when params differ', () => {
    const calls: RecentToolCall[] = [
      { name: 'read_file', params: { path: '/a.ts' } },
      { name: 'read_file', params: { path: '/b.ts' } },
      { name: 'read_file', params: { path: '/c.ts' } },
    ];
    const result = detectToolLoops(calls);
    expect(result.injection).toBeNull();
  });

  it('does not treat changing tool results as a stalled loop', () => {
    const calls: RecentToolCall[] = [
      { name: 'poll_job', params: { id: 'job-1' }, resultPreview: 'running: 10%' },
      { name: 'poll_job', params: { id: 'job-1' }, resultPreview: 'running: 70%' },
      { name: 'poll_job', params: { id: 'job-1' }, resultPreview: 'complete' },
    ];
    const result = detectToolLoops(calls);
    expect(result.injection).toBeNull();
    expect(result.hiddenTools.size).toBe(0);
  });

  it('blocks repeated calls with the same arguments and result', () => {
    const calls: RecentToolCall[] = Array.from({ length: 3 }, () => ({
      name: 'poll_job',
      params: { id: 'job-1' },
      resultPreview: 'running: 10%',
    }));
    const result = detectToolLoops(calls);
    expect(result.hiddenTools.has('poll_job')).toBe(true);
  });

  it('should not trigger when different tool is interleaved (breaks consecutive)', () => {
    const calls: RecentToolCall[] = [
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'grep', params: { pattern: 'hello' } },
      { name: 'find', params: { pattern: '*.ts' } },
    ];
    const result = detectToolLoops(calls);
    // After interleave, only 1 consecutive 'find' at the end — below threshold
    expect(result.hiddenTools.size).toBe(0);
    // But the first group of 2 consecutive should trigger soft warning
    expect(result.injection).toContain('find');
  });

  it('should detect high-frequency non-consecutive patterns', () => {
    // A→B→A→B→A pattern (5 calls of 'find' with same params, interleaved)
    const calls: RecentToolCall[] = [
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'grep', params: { query: 'x' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'grep', params: { query: 'x' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'grep', params: { query: 'x' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'grep', params: { query: 'x' } },
    ];
    const result = detectToolLoops(calls, { softThreshold: 2, hideThreshold: 3 });
    // 4 occurrences of find (above hideThreshold+1=4), should be warned about
    expect(result.injection).toContain('LOOP DETECTION');
  });

  it('should respect custom thresholds', () => {
    const calls: RecentToolCall[] = [
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
      { name: 'find', params: { pattern: '*.ts' } },
    ];
    const result = detectToolLoops(calls, { softThreshold: 3, hideThreshold: 5 });
    expect(result.injection).toContain('LOOP DETECTION');
    expect(result.hiddenTools.has('find')).toBe(true);
  });

  it('should handle nested object params with key ordering differences', () => {
    const calls: RecentToolCall[] = [
      { name: 'search', params: { query: 'hello', options: { caseSensitive: true, limit: 10 } } },
      { name: 'search', params: { options: { limit: 10, caseSensitive: true }, query: 'hello' } },
    ];
    const result = detectToolLoops(calls);
    // Should detect as identical despite key order difference
    expect(result.injection).toContain('LOOP DETECTION');
  });

  it('should handle long string params gracefully', () => {
    const longContent = 'x'.repeat(500);
    const calls: RecentToolCall[] = [
      { name: 'write', params: { path: '/a.ts', content: longContent } },
      { name: 'write', params: { path: '/a.ts', content: longContent } },
    ];
    const result = detectToolLoops(calls);
    expect(result.injection).toContain('LOOP DETECTION');
  });
});
