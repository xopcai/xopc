import { describe, expect, it } from 'vitest';

import { displayLocalAppIdea } from '../display';

describe('displayLocalAppIdea', () => {
  it('replaces legacy chat preview metadata with the app name', () => {
    expect(displayLocalAppIdea(
      'Promoted from chat preview 36143946-7d2c-47ab-afd3-e9ddd821645e at revision 074aaa0881204290c7cda05e0c63cf74',
      '简洁登录页面预览',
    )).toBe('简洁登录页面预览');
  });

  it('keeps user-authored ideas unchanged', () => {
    expect(displayLocalAppIdea('增加月视图，并支持按标签筛选', '阅读清单'))
      .toBe('增加月视图，并支持按标签筛选');
  });
});
