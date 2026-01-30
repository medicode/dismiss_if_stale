// A script to check if there are any approvals on a PR.
// Outputs the SHA of the commit and review ID for the most recent approval,
// or 'null' if there are no approvals.

import {PullRequest} from './pull-request'

export interface ApprovalInfo {
  approved_sha: string
  review_id: number
}

export async function checkForApprovals(
  token: string
): Promise<ApprovalInfo | null> {
  const reviews = new PullRequest(token)
  const approved_reviews = await reviews.getApprovedReviews()
  if (approved_reviews.length === 0) {
    return null
  }
  const latest = approved_reviews[approved_reviews.length - 1]
  return {
    approved_sha: latest.commit_id ?? '',
    review_id: latest.id,
  }
}
