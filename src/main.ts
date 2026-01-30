import * as core from '@actions/core'
import {checkForApprovals} from './check-for-approvals'
import {dismissIfStale} from './dismiss-if-stale'

async function run(): Promise<void> {
  try {
    const mode: string = core.getInput('mode', {required: true})
    const token = core.getInput('token', {required: true})
    if (mode === 'check-for-approvals') {
      const result = await checkForApprovals(token)
      core.debug(`approval result: ${JSON.stringify(result)}`)
      if (result != null) {
        core.setOutput('approved_sha', result.approved_sha)
        core.setOutput('review_id', result.review_id.toString())
      } else {
        core.setOutput('approved_sha', '')
        core.setOutput('review_id', '')
      }
    } else if (mode === 'dismiss-stale-reviews') {
      await dismissIfStale({
        token,
        path_to_cached_diff: core.getInput('path_to_cached_diff', {
          required: true,
        }),
        repo_path: core.getInput('repo_path', {required: true}),
      })
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('Unknown error')
    }
  }
}

run()
