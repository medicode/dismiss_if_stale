// Dismiss PR approval if the review is "stale"
// i.e. the diff of code changes has changed since the review was submitted
//
// This script is intended to run in a GitHub Actions workflow.

import fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {PayloadRepository} from '@actions/github/lib/interfaces'
import {PullRequest} from './pull-request'
import {execSync} from 'child_process'

// assumes that there exists at least one approval to dismiss
export async function dismissIfStale({
  token,
  path_to_cached_diff,
  repo_path
}: {
  token: string
  path_to_cached_diff: string
  repo_path: string
}): Promise<void> {
  // Only run if the PR's branch was updated (synchronize) or the base branch
  // was changed (edited event was triggered and the changes field of the event
  // indicates the base being changed).
  //
  // github.context.payload is the same as the github.event GitHub Actions Context[1].
  // For a reference on the event payloads, see [2].
  //
  // [1] https://docs.github.com/en/actions/learn-github-actions/contexts
  // [2] https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads?actionType=edited#pull_request
  //     https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads?actionType=synchronize#pull_request
  if (
    github.context.payload.action !== 'synchronize' &&
    (github.context.payload.action !== 'edited' ||
      !github.context.payload.changes.base ||
      !github.context.payload.changes.base.sha.from)
  ) {
    core.debug(
      `event action is ${github.context.payload.action}, ` +
        `complete payload=${github.context.payload}; skipping dismissal check.`
    )
    return
  }

  const pull_request = new PullRequest(token)
  const diffs_dir = core.getInput('diffs_directory')

  // let reviewed_diff = await genReviewedDiff(path_to_cached_diff, pull_request)
  // if (reviewed_diff) {
  //   reviewed_diff = normalizeDiff(reviewed_diff)
  //   core.debug(`reviewed_diff:\n${reviewed_diff}`)
  //   if (diffs_dir) {
  //     fs.writeFileSync(`${diffs_dir}/reviewed.diff`, reviewed_diff)
  //   }
  // }
  const reviewed_diff = null

  // Generate the current diff.
  const pull_request_payload = github.context.payload.pull_request
  if (!pull_request_payload || !github.context.payload.repository) {
    throw new Error('This action must be run on a pull request.')
  }
  core.info(
    genTwoDotDiff(
      github.context.payload.repository,
      repo_path,
      pull_request_payload.base.sha,
      pull_request_payload.head.sha
    )
  )
  let current_diff = await pull_request.compareCommits(
    pull_request_payload.base.sha,
    pull_request_payload.head.sha
  )
  current_diff = normalizeDiff(current_diff)
  core.debug(`current_diff:\n${current_diff}`)
  if (diffs_dir) {
    fs.writeFileSync(`${diffs_dir}/current.diff`, current_diff)
  }

  // If the diffs are different or we weren't able to get the reviewed diff, then the
  // review is (pessimistically) considered stale.
  if (reviewed_diff !== current_diff) {
    let msg
    if (!reviewed_diff) {
      msg =
        'Unable to get the most recently reviewed diff. ' +
        'Pessimistically dismissing stale reviews.'
    } else {
      msg = 'Code has changed, dismissing stale reviews.'
    }
    core.notice(msg)
    await pull_request.dismissApprovals(msg)
  }
}

async function genReviewedDiff(
  path_to_cached_diff: string,
  pull_request: PullRequest
): Promise<string | null> {
  // check if the cached diff exists
  core.debug(`Checking for cached diff at ${path_to_cached_diff}.`)
  if (fs.existsSync(path_to_cached_diff)) {
    core.notice('Using cached diff of most recent approval.')
    return fs.readFileSync(path_to_cached_diff, {encoding: 'utf8'})
  }
  return await pull_request.getMostRecentlyReviewedDiff()
}

function normalizeDiff(diff: string): string {
  // Normalize the diff by dropping the file hash metadata[1]
  // because we are only concerned with the changes in the file contents which the
  // reviewer would have seen.
  //
  // [1] https://www.git-tower.com/learn/git/ebook/en/command-line/advanced-topics/diffs
  //     Basically, these are the "index <sha1>..<sha2>" lines in the diff output.
  //     Note that these lines may be terminated by an optional " <mode>" suffix.
  return diff.replace(/^index [0-9a-f]+\.\.[0-9a-f]+/gm, '')
}

function genTwoDotDiff(
  repository: PayloadRepository,
  repo_path: string,
  base_sha: string,
  head_sha: string
): string {
  // GitHub API doesn't support generating two-dot diffs (diffs between files in two
  // commits), so we do it ourselves by
  // 1. clone the repo if needed
  // 2. fetch the base and head commits
  // 3. generate the diff using git diff

  // clone the repo if needed
  const repo_url = repository.clone_url
  if (!fs.existsSync(repo_path)) {
    core.debug(`Cloning ${repository.full_name} to ${repo_path}.`)
    fs.mkdirSync(repo_path, {recursive: true})
    // list the files in the current directory
    core.info(execSync('pwd && ls -l').toString())
    execSync(`git clone --depth=1 ${repo_url} ${repo_path}`)
  }

  // fetch the base and head commits
  core.debug(`Fetching ${base_sha} and ${head_sha}.`)
  const cwd = process.cwd()
  process.chdir(repo_path)
  execSync(`git fetch --depth=1 origin ${base_sha} ${head_sha}`, {
    cwd: repo_path
  })
  process.chdir(cwd)

  // generate the diff
  core.debug(`Generating diff between ${base_sha} and ${head_sha}.`)
  return execSync(`git diff ${base_sha} ${head_sha}`).toString()
}
