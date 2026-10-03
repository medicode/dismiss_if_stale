import {expect, describe, test} from '@jest/globals'
import {isReviewStale} from '../src/dismiss-if-stale'

describe('isReviewStale', () => {
  test.each([
    {
      description: 'matching diffs',
      reviewedDiff: 'approved diff',
      currentDiff: 'approved diff',
      expected: false,
    },
    {
      description: 'different diffs',
      reviewedDiff: 'approved diff',
      currentDiff: 'updated diff',
      expected: true,
    },
    {
      description: 'an unavailable reviewed diff',
      reviewedDiff: null,
      currentDiff: 'current diff',
      expected: true,
    },
    {
      description: 'an unavailable current diff',
      reviewedDiff: 'approved diff',
      currentDiff: null,
      expected: true,
    },
    {
      description: 'both diffs unavailable',
      reviewedDiff: null,
      currentDiff: null,
      expected: true,
    },
    {
      description: 'matching empty diffs',
      reviewedDiff: '',
      currentDiff: '',
      expected: false,
    },
    {
      description: 'an empty diff and a non-empty diff',
      reviewedDiff: '',
      currentDiff: 'updated diff',
      expected: true,
    },
  ])('$description', ({reviewedDiff, currentDiff, expected}) => {
    expect(isReviewStale(reviewedDiff, currentDiff)).toBe(expected)
  })
})
