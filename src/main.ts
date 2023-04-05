import * as core from '@actions/core'
import {checkForApprovals} from './check-for-approvals'
import {dismissIfStale} from './dismiss-if-stale'

async function run(): Promise<void> {
  try {
    const mode: string = core.getInput('mode', {required: true})
    const token = core.getInput('token', {required: true})
    if (mode === 'check-for-approvals') {
      const approved_sha = await checkForApprovals(token)
      core.debug(`approved_sha: ${approved_sha}`)
      core.setOutput('approved_sha', approved_sha)
    } else if (mode === 'dismiss-stale-reviews') {
      await dismissIfStale({
        token,
        path_to_cached_diff: core.getInput('path_to_cached_diff', {
          required: true
        })
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
