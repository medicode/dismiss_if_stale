// A module for common code to get the state of a PR.

import * as core from '@actions/core'
import * as github from '@actions/github'
import {GitHub} from '@actions/github/lib/utils'
// unclear why linter is failing here...
// eslint-disable-next-line import/named
import {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods'

type ListOfReviews =
  RestEndpointMethodTypes['pulls']['listReviews']['response']['data']

type ListOfEvents =
  RestEndpointMethodTypes['issues']['listEvents']['response']['data']

// A class for interacting with the GitHub API to get the state of reviews.
export class PullRequest {
  octokit: InstanceType<typeof GitHub>
  owner: string
  repo: string
  pull_number: number

  constructor(token: string) {
    this.octokit = github.getOctokit(token)

    if (
      !github.context.payload.repository ||
      !github.context.payload.pull_request
    ) {
      throw new Error('This action must be run on a pull request.')
    }
    if (!github.context.payload.repository.full_name) {
      throw new Error('Unable to determine repository name.')
    }
    const [owner, repo] = github.context.payload.repository.full_name.split('/')
    this.owner = owner
    this.repo = repo
    this.pull_number = github.context.payload.pull_request.number
  }

  // Get all of the approved reviews for the PR in chronological order.
  async getApprovedReviews(): Promise<ListOfReviews> {
    // Use paginate() to ensure we get all of the reviews, and dismiss all of the
    // approvals.
    const reviews = await this.octokit.paginate(
      this.octokit.rest.pulls.listReviews,
      {
        owner: this.owner,
        repo: this.repo,
        pull_number: this.pull_number,
      }
    )
    // log the reviews to help debug
    core.info(`found ${reviews.length} reviews`)
    for (const review of reviews) {
      core.info(
        `review: ${review.id} ${review.commit_id} ${review.state} ${review.submitted_at}`
      )
    }

    return reviews.filter(review => review.state === 'APPROVED')
  }

  async dismissApprovals(message: string): Promise<void> {
    const approved_reviews = await this.getApprovedReviews()
    const requests = []
    for (const review of approved_reviews) {
      requests.push(
        this.octokit.rest.pulls.dismissReview({
          owner: this.owner,
          repo: this.repo,
          pull_number: this.pull_number,
          review_id: review.id,
          message,
        })
      )
    }
    await Promise.all(requests)
  }

  async getEvents(): Promise<ListOfEvents> {
    // get events in chronological order
    const events = await this.octokit.paginate(
      this.octokit.rest.issues.listEvents,
      {
        owner: this.owner,
        repo: this.repo,
        issue_number: this.pull_number,
      }
    )
    // @ts-expect-error: unclear why tsc thinks `id` can be undefined, and irrelevant to
    // our usage of events anyways
    return events
  }

  async compareCommits(base: string, head: string): Promise<string> {
    const response = await this.octokit.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${base}...${head}`,
      headers: {
        Accept: 'application/vnd.github.diff',
      },
    })
    if (response.status !== 200) {
      throw new Error(`Got status ${response.status} from GitHub API.`)
    }
    if (typeof response.data !== 'string') {
      throw new Error('Response from GitHub API was not a string.')
    }
    return response.data
  }

  async getMostRecentlyReviewedDiff(): Promise<string | null> {
    // We can do this only if we are able to determine what the target branch was at the
    // time of the approval, and the target branch exists.
    // May return null if unable to get the diff.

    const approved_reviews = await this.getApprovedReviews()
    const most_recent_review = approved_reviews[approved_reviews.length - 1]
    const time_of_approval = most_recent_review.submitted_at
    if (!time_of_approval) {
      throw new Error('Unable to determine time of approval.')
    }
    // example time_of_approval: "2021-03-02T20:30:00Z"

    if (!github.context.payload.pull_request) {
      throw new Error('This action must be run on a pull request.')
    }
    const base_branch = github.context.payload.pull_request.base.ref
    const events = await this.getEvents()
    // iterate over events in reverse chronological order to see if the target branch
    // was changed since the approval
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (!event.created_at) {
        throw new Error('Unable to determine time of event.')
      }
      if (event.created_at < time_of_approval) {
        // we've reached the first event that happened before the approval, and did not
        // detect a target branch change, so we can compute the diff
        break
      }
      if (event.event === 'base_ref_changed') {
        // The target branch was changed, so we can't generate the diff cuz we don't know
        // what the previous branch was via the REST API.
        // Technically we _can_ get this information via the GraphQL API, but unclear how
        // useful this would be anyways.
        return null
      }
    }
    // Did not early return, thus we have a target branch we can compute a diff against.
    // If the base branch or head ref was deleted / garbage collected (e.g. a forced
    // push resulted in the previously reviewed head to be orphaned), then this will
    // fail.
    if (!most_recent_review.commit_id) {
      throw new Error('Unable to determine commit ID of review.')
    }
    try {
      return await this.compareCommits(
        base_branch,
        most_recent_review.commit_id
      )
    } catch (error) {
      if (error instanceof Error) {
        core.warning(
          `Unable to get diff for ${base_branch}...${most_recent_review.commit_id}: ${error.message}`
        )
      } else {
        core.warning(
          `Unable to get diff for ${base_branch}...${most_recent_review.commit_id}: ` +
            `unknown error: ${error}`
        )
      }
      return null
    }
  }
}
