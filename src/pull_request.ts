// A module for common code to get the state of a PR.

import * as core from '@actions/core';
// import type Github from @actions/github
import * as github from '@actions/github';

// A class for interacting with the GitHub API to get the state of reviews.
export class PullRequest {

  octokit: any;  // should be github.GitHub, but VSCode is complaining...
  owner: string;
  repo: string;
  pull_number: number;

  constructor(token: string) {
    this.octokit = github.getOctokit(token);

    if (!github.context.payload.repository || !github.context.payload.pull_request) {
      throw new Error('This action must be run on a pull request.');
    }
    if (!github.context.payload.repository.full_name) {
      throw new Error('Unable to determine repository name.');
    }
    const [owner, repo] = github.context.payload.repository.full_name.split('/');
    this.owner = owner;
    this.repo = repo;
    this.pull_number = github.context.payload.pull_request.number;
  }

  // Get all of the approved reviews for the PR in chronological order.
  async getApprovedReviews() {
    // Use paginate() to ensure we get all of the reviews, and dismiss all of the
    // approvals.
    const reviews = await this.octokit.paginate(this.octokit.rest.pulls.listReviews, {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pull_number,
    });

    return reviews.filter((review: { state: string; }) => review.state === 'APPROVED');
  }

  async dismissApprovals() {
    const approved_reviews = await this.getApprovedReviews();
    const requests = [];
    for (const review of approved_reviews) {
      requests.push(this.octokit.rest.pulls.dismissReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.pull_number,
        review_id: review.id,
        message: 'Code has been changed, dismissing stale review.',
      }));
    }
    await Promise.all(requests);
  }

  async getEvents() {
    // get events in chronological order
    const events = await this.octokit.paginate(this.octokit.rest.issues.listEvents, {
      owner: this.owner,
      repo: this.repo,
      issue_number: this.pull_number,
    });
    return events;
  }

  async compareCommits(base: string, head: string) {
    const response = await this.octokit.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${base}...${head}`,
      headers: {
        'Accept': 'application/vnd.github.diff'
      },
    });
    if (response.status !== 200) {
      throw new Error(`Got status ${response.status} from GitHub API.`);
    }
    return response.data;
  }

  async getMostRecentlyReviewedDiff() {
    // We can do this only if we are able to determine what the target branch was at the
    // time of the approval, and the target branch exists.
    // May return null if unable to get the diff.

    const approved_reviews = await this.getApprovedReviews();
    const most_recent_review = approved_reviews[approved_reviews.length - 1];
    const time_of_approval = most_recent_review.submitted_at;
    // example time_of_approval: "2021-03-02T20:30:00Z"

    if (!github.context.payload.pull_request) {
      throw new Error('This action must be run on a pull request.');
    }
    const base_branch = github.context.payload.pull_request.base.ref;
    const events = await this.getEvents();
    // iterate over events in reverse chronological order to see if the target branch
    // was changed since the approval
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.created_at < time_of_approval) {
        // we've reached the first event that happened before the approval, and did not
        // detect a target branch change, so we can compute the diff
        break;
      }
      if (event.event === 'base_ref_changed') {
        // The target branch was changed, so we can't generate the diff cuz we don't know
        // what the previous branch was via the REST API.
        // Technically we _can_ get this information via the GraphQL API, but unclear how
        // useful this would be anyways.
        return null;
      }
    }
    // Did not early return, thus we have a target branch we can compute a diff against.
    // If the base branch or head ref was deleted / garbage collected (e.g. a forced
    // push resulted in the previously reviewed head to be orphaned), then this will
    // fail.
    try {
      return await this.compareCommits(base_branch, most_recent_review.commit_id);
    } catch (error) {
      if (error instanceof Error) {
        core.warning(
          `Unable to get diff for ${base_branch}...${most_recent_review.commit_id}: `
          + error.message
        );
      } else {
        core.warning(
          `Unable to get diff for ${base_branch}...${most_recent_review.commit_id}: `
          + 'unknown error: ' + error
        );
      }
      return null;
    }
  }
}
