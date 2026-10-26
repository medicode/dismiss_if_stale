import {
  expect,
  describe,
  test,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as github from '@actions/github'
import {PullRequest} from '../src/pull-request'
import {dismissIfStale, isReviewStale} from '../src/dismiss-if-stale'

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

describe('dismissIfStale when diff retrieval fails', () => {
  const originalPayload = github.context.payload
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dismiss-if-stale-test-'))
    github.context.payload = {
      action: 'synchronize',
      repository: {
        full_name: 'owner/repo',
        name: 'repo',
        owner: {login: 'owner'},
      },
      pull_request: {
        number: 1,
        base: {sha: 'base-sha', ref: 'main'},
        head: {sha: 'head-sha'},
      },
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    github.context.payload = originalPayload
    fs.rmSync(tempDir, {recursive: true, force: true})
  })

  test('reports both diffs unavailable when retrieval fails for both', async () => {
    const getReviewedDiff = jest
      .spyOn(PullRequest.prototype, 'getMostRecentlyReviewedDiff')
      .mockResolvedValue(null)
    const compareCommits = jest
      .spyOn(PullRequest.prototype, 'compareCommits')
      .mockRejectedValue(new Error('GitHub API unavailable'))
    const dismissApprovals = jest
      .spyOn(PullRequest.prototype, 'dismissApprovals')
      .mockResolvedValue()

    await dismissIfStale({
      token: 'test-token',
      path_to_cached_diff: path.join(tempDir, 'reviewed.diff'),
      path_to_cached_metadata: path.join(tempDir, 'metadata.json'),
      repo_path: path.join(tempDir, 'repo'),
      range_diff_fetch_depth: 0,
    })

    expect(getReviewedDiff).toHaveBeenCalledTimes(1)
    expect(compareCommits).toHaveBeenCalledWith('base-sha', 'head-sha')
    expect(dismissApprovals).toHaveBeenCalledWith(
      'Unable to get both the reviewed and current diffs. ' +
        'Pessimistically dismissing stale reviews.'
    )
  })
})
