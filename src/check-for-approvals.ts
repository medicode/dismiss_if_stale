// A script to check if there are any approvals on a PR.
// Outputs the SHA of the commit for the most recent approval, or 'null' if there are
// no approvals.

import {PullRequest} from './pull-request'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {genTwoDotDiff} from './dismiss-if-stale'

export async function checkForApprovals(token: string): Promise<string | null> {
  // start hacky test for gh repo clone
  const repo_path = core.getInput('repo_path', {required: true})
  if (!github.context.payload.repository) {
    throw new Error(
      'This action must be run on a pull request with repository made available in ' +
        'the payload.'
    )
  }
  const repository = github.context.payload.repository
  const diff = genTwoDotDiff({
    repository,
    token,
    repo_path,
    base_sha: github.context.payload.pull_request?.base.sha,
    head_sha: github.context.payload.pull_request?.head.sha,
  })
  core.info(`diff:\n${diff}`)
  // end hacky test
  const reviews = new PullRequest(token)
  const approved_reviews = await reviews.getApprovedReviews()
  if (approved_reviews.length === 0) {
    return null
  }
  return approved_reviews[approved_reviews.length - 1].commit_id
}
