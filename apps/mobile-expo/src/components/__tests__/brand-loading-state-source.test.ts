import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('mobile destination loading experience', () => {
  it('provides an accessible branded animation that respects reduced motion', () => {
    const source = read('../BrandLoadingState.tsx');
    expect(source).toContain('AccessibilityInfo.isReduceMotionEnabled');
    expect(source).toContain('reduceMotionChanged');
    expect(source).toContain('<XopcLogo');
    expect(source).toContain('accessibilityRole="progressbar"');
  });

  it('uses branded loading on primary detail routes', () => {
    const routes = [
      '../../features/page/PageScreen.tsx',
      '../../features/tasks/TaskDetailScreen.tsx',
      '../../features/tasks/ProjectOperatingScreen.tsx',
      '../../features/settings/UnderstandingDetailScreen.tsx',
      '../../features/automation/AutomationDetailScreen.tsx',
      '../../features/automation/AutomationRunDetailScreen.tsx',
      '../../features/workflows/WorkflowScreens.tsx',
    ];
    for (const route of routes) expect(read(route)).toContain('BrandLoadingState');
  });
});
