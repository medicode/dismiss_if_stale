// Dismiss PR approval if the review is "stale"
// i.e. the diff of code changes has changed since the review was submitted
//
// This script is intended to run in a GitHub Actions workflow.

import fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {PayloadRepository} from '@actions/github/lib/interfaces'
import {PullRequest} from './pull-request'
import {execSync, spawnSync} from 'child_process'
import {
  ApprovalMetadata,
  parseRangeDiffOutput,
  runRangeDiff,
} from './range-diff'

// assumes that there exists at least one approval to dismiss
export async function dismissIfStale({
  token,
  path_to_cached_diff,
  path_to_cached_metadata,
  repo_path,
}: {
  token: string
  path_to_cached_diff: string
  path_to_cached_metadata: string
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
  const pull_request_payload = github.context.payload.pull_request
  if (!pull_request_payload) {
    throw new Error('This action must be run on a pull request.')
  }

  // Try range-diff check first as a "fast pass" - if it shows no changes,
  // we can exit early without doing the more expensive diff comparison.
  const rangeDiffResult = await tryRangeDiffCheck({
    path_to_cached_metadata,
    pull_request,
    repo_path,
    current_head: pull_request_payload.head.sha,
    base_ref: pull_request_payload.base.ref,
  })

  if (rangeDiffResult === 'not_stale') {
    core.notice(
      'Range-diff shows no changes to commits since approval. Review is not stale.'
    )
    return
  }
  // If rangeDiffResult is 'stale' or 'fallback', continue to existing diff comparison

  let reviewed_diff = await genReviewedDiff(path_to_cached_diff, pull_request)
  if (reviewed_diff) {
    reviewed_diff = normalizeDiff(reviewed_diff)
    const reviewed_diff_snippet = reviewed_diff.slice(0, 5000)
    core.debug(
      `reviewed_diff (first 5000 characters):\n${reviewed_diff_snippet}`
    )
    if (diffs_dir) {
      fs.writeFileSync(`${diffs_dir}/reviewed.diff`, reviewed_diff)
    }
  }

  // Generate the current diff.
  let current_diff = await pull_request.compareCommits(
    pull_request_payload.base.sha,
    pull_request_payload.head.sha
  )
  current_diff = normalizeDiff(current_diff)
  const current_three_dot_diff_snippet = current_diff.slice(0, 5000)
  core.debug(
    `current three dot diff (first 5000 characters):\n${current_three_dot_diff_snippet}`
  )

  let msg = ''
  if (reviewed_diff && reviewed_diff !== current_diff) {
    // Consider the case of
    //
    //   main -> branch1 -> branch2
    //
    // where branch2 is the PR branch and branch1 is the base branch.
    //
    // If branch1 was just merged into main and branch2 can be cleanly merged into main,
    // then the three dot diff computed by GitHub (the diff with respect to the common
    // ancestor of main and branch2) will show the changes from branch2 and branch1.
    // The changes themselves haven't actually changed, this is just an artifact of the
    // type of diff being computed.
    // We instead want to compute a two dot diff (the straight diff between the files in
    // the repository at these two commits) - in this case if the only changes on main
    // are the recently merged in changes from branch1, then this will result in a diff
    // showing only the changes from branch2.
    // Technically, if there are additional changes landed into the base branch before
    // we compute the two dot diff here, then the review will be considered stale even
    // though the code changes on branch2 are still the same - this is an accepted
    // limitation.
    if (!github.context.payload.repository) {
      throw new Error(
        'This action must be run on a pull request with repository made available in ' +
          'the payload.'
      )
    }
    const twoDot = genTwoDotDiff({
      repository: github.context.payload.repository,
      token,
      repo_path,
      base_sha: pull_request_payload.base.sha,
      head_sha: pull_request_payload.head.sha,
    })
    if (twoDot !== null) {
      current_diff = normalizeDiff(twoDot)
      const current_two_dot_diff_snippet = current_diff.slice(0, 5000)
      core.debug(
        `current two dot diff (first 5000 characters):\n${current_two_dot_diff_snippet}`
      )
    } else {
      msg =
        'Unable to compute two-dot diff (too large or failed). Pessimistically dismissing stale reviews.'
    }
  }
  if (diffs_dir) {
    fs.writeFileSync(`${diffs_dir}/current.diff`, current_diff)
  }

  // If the diffs are different, unable to generate the current diff, or we weren't able
  // to get the reviewed diff, then the review is (pessimistically) considered stale.
  if (reviewed_diff !== current_diff) {
    if (!reviewed_diff) {
      msg =
        'Unable to get the most recently reviewed diff. ' +
        'Pessimistically dismissing stale reviews.'
    } else if (msg === '') {
      msg = 'Code has changed, dismissing stale reviews.'
    }
    core.notice(msg)
    await pull_request.dismissApprovals(msg)
  }
}

type RangeDiffCheckResult = 'not_stale' | 'stale' | 'fallback'

/**
 * Try to determine staleness using git range-diff.
 *
 * Range-diff compares two commit ranges and identifies if commits were modified,
 * added, or removed. This is more accurate than diff comparison for rebases
 * that don't change the actual code.
 *
 * @returns 'not_stale' if range-diff confirms no changes, 'stale' if changes detected,
 *          'fallback' if range-diff couldn't be run (missing metadata, git error, etc.)
 */
async function tryRangeDiffCheck({
  path_to_cached_metadata,
  pull_request,
  repo_path,
  current_head,
  base_ref,
}: {
  path_to_cached_metadata: string
  pull_request: PullRequest
  repo_path: string
  current_head: string
  base_ref: string
}): Promise<RangeDiffCheckResult> {
  // Load cached metadata
  core.debug(`Checking for cached metadata at ${path_to_cached_metadata}.`)
  if (!path_to_cached_metadata || !fs.existsSync(path_to_cached_metadata)) {
    core.debug('No cached metadata found, falling back to diff comparison.')
    return 'fallback'
  }

  let metadata: ApprovalMetadata
  try {
    const rawMetadata = fs.readFileSync(path_to_cached_metadata, {
      encoding: 'utf8',
    })
    metadata = JSON.parse(rawMetadata) as ApprovalMetadata
    core.debug(`Loaded approval metadata: ${JSON.stringify(metadata)}`)
  } catch (error) {
    core.warning(
      `Failed to parse cached metadata: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return 'fallback'
  }

  // Validate metadata version and required fields
  if (metadata.version !== 1) {
    core.warning(
      `Unsupported metadata version: ${metadata.version}, falling back to diff comparison.`
    )
    return 'fallback'
  }

  if (!metadata.approved_sha || !metadata.merge_base_sha) {
    core.warning(
      'Metadata missing required fields (approved_sha or merge_base_sha), falling back.'
    )
    return 'fallback'
  }

  // Get current merge base
  let currentMergeBase: string
  try {
    currentMergeBase = await pull_request.getMergeBase(base_ref, current_head)
    core.debug(`Current merge base: ${currentMergeBase}`)
  } catch (error) {
    core.warning(
      `Failed to get current merge base: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return 'fallback'
  }

  // Run git range-diff
  const rangeDiffOutput = runRangeDiff({
    repoPath: repo_path,
    prevMergeBase: metadata.merge_base_sha,
    approvedSha: metadata.approved_sha,
    currMergeBase: currentMergeBase,
    currentHead: current_head,
  })

  if (rangeDiffOutput === null) {
    core.debug('Range-diff failed, falling back to diff comparison.')
    return 'fallback'
  }

  const result = parseRangeDiffOutput(rangeDiffOutput)
  core.debug(`Range-diff result: ${JSON.stringify(result)}`)

  if (result.isStale) {
    core.info(`Range-diff detected changes: ${result.summary}`)
    // Continue to diff comparison for final determination
    return 'stale'
  }

  core.info(`Range-diff shows no changes: ${result.summary}`)
  return 'not_stale'
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

function genTwoDotDiff({
  repository,
  token,
  repo_path,
  base_sha,
  head_sha,
}: {
  repository: PayloadRepository
  token: string
  repo_path: string
  base_sha: string
  head_sha: string
}): string | null {
  // GitHub API doesn't support generating two-dot diffs (diffs between files in two
  // commits), so we do it ourselves by
  // 1. clone the repo if needed
  // 2. fetch the base and head commits
  // 3. generate the diff using git diff

  // clone the repo if needed
  let env = process.env
  if (!fs.existsSync(repo_path)) {
    core.debug(`Cloning ${repository.full_name} to ${repo_path}.`)
    fs.mkdirSync(repo_path, {recursive: true})
    // Use gh versus git clone - makes authentication via token easier.
    // Note that the env here is propagated to subsequent git commands - this is
    // needed for gh to use the token.
    env = {
      ...env,
      GITHUB_TOKEN: token,
    }
    execSync(
      `gh repo clone ${repository.full_name} ${repo_path} -- --depth=1`,
      {
        env,
        stdio: 'ignore', // drop maybe large output - it's not important
        // all of the execSync calls below haven't had their output suppressed because
        // it can be useful for debugging, and they shouldn't be too large
      }
    )
    core.debug('Configuring git to use gh as a credential helper.')
    execSync('gh auth setup-git', {
      env,
      cwd: repo_path,
    })
  }

  // fetch the base and head commits
  core.debug(`Fetching ${base_sha} and ${head_sha}.`)
  execSync(`git fetch --depth=1 origin ${base_sha} ${head_sha}`, {
    env,
    cwd: repo_path,
  })

  // generate the diff
  core.debug(`Generating diff between ${base_sha} and ${head_sha}.`)
  // Use spawn instead of exec here because we want to get the (potentially large)
  // output of the diff command as a string.
  // Refer to
  // https://www.hacksparrow.com/nodejs/difference-between-spawn-and-exec-of-node-js-child-rocess.html
  // for more details on using exec vs spawn.
  const diffResult = spawnSync(
    'git',
    [
      '-c',
      'core.pager=cat',
      'diff',
      '--no-ext-diff',
      '--no-color',
      base_sha,
      head_sha,
    ],
    {
      env: {
        ...env,
        GIT_PAGER: 'cat',
      },
      cwd: repo_path,
      encoding: 'utf8',
      // Keep a reasonable buffer; if exceeded we'll return null and pessimistically dismiss
      maxBuffer: 32 * 1024 * 1024,
    }
  )

  if (diffResult.error) {
    const err = diffResult.error as Error & {code?: string}
    const codeInfo = err?.code ? ` code=${err.code}` : ''
    if (err?.code === 'ENOBUFS') {
      core.warning(
        `git diff output exceeded buffer (${repo_path}). Returning null to allow pessimistic dismissal.${codeInfo}`
      )
      return null
    }
    core.error(
      `Failed to spawn git diff in ${repo_path}: ${String(
        err?.message || err
      )}${codeInfo}`
    )
    return null
  }

  // git diff returns 0 (no changes) or 1 (changes found). >1 indicates an error.
  if (typeof diffResult.status === 'number' && diffResult.status > 1) {
    const stderr = (diffResult.stderr || '').toString()
    core.error(
      `git diff exited with code ${diffResult.status} (cwd=${repo_path}). stderr:\n${stderr}`
    )
    return null
  }

  // With encoding set, stdout is guaranteed to be a string.
  return diffResult.stdout || ''
}
