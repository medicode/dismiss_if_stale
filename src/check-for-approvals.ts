// A script to check if there are any approvals on a PR.
// Outputs the SHA of the commit for the most recent approval, or 'null' if there are
// no approvals.

import {PullRequest} from './pull-request'

export async function checkForApprovals(token: string): Promise<string | null> {
  const reviews = new PullRequest(token)
  const approved_reviews = await reviews.getApprovedReviews()
  if (approved_reviews.length === 0) {
    return null
  }
  return approved_reviews[approved_reviews.length - 1].commit_id
}
