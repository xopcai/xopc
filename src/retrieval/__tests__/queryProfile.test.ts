import { describe, expect, it } from 'vitest';

import { buildRetrievalQueryProfile, isSelfReviewQuery } from '../queryProfile.js';

describe('retrieval query profile', () => {
  it('detects explicit self-review requests without treating ordinary personal tasks as reviews', () => {
    expect(isSelfReviewQuery('介绍下你认识的我')).toBe(true);
    expect(isSelfReviewQuery('你知道关于我的什么？')).toBe(true);
    expect(isSelfReviewQuery('What do you know about me?')).toBe(true);
    expect(isSelfReviewQuery('帮我安排今天的工作')).toBe(false);
    expect(buildRetrievalQueryProfile('介绍下你认识的我').selfReview).toBe(true);
  });
});
