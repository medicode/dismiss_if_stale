// Abstraction(s) around interacting with a git repository.
import fs from 'fs'
import * as core from '@actions/core'
import {execSync, spawnSync} from 'child_process'

export class GitRepo {
  token: string
  // for some reason eslint doesn't like NodeJS here, seems like it could be a bug
  // from Googling around e.g. https://github.com/Chatie/eslint-config/issues/45
  // eslint-disable-next-line no-undef
  exec_env: NodeJS.ProcessEnv
  repo_full_name: string
  repo_path: string

  constructor({
    token,
    repo_full_name,
    repo_path,
  }: {
    token: string
    repo_full_name: string
    repo_path: string
  }) {
    this.token = token
    this.exec_env = {
      ...process.env,
      GITHUB_TOKEN: token,
    }
    // Note that the env here is propagated to subsequent git commands - this is
    // needed for gh CLI to use the token.
    this.repo_full_name = repo_full_name
    this.repo_path = repo_path
  }

  cloneIfNeeded(): void {
    if (fs.existsSync(this.repo_path)) {
      return
    }
    core.debug(`Cloning ${this.repo_full_name} to ${this.repo_path}.`)
    fs.mkdirSync(this.repo_path, {recursive: true})
    // Use gh versus git clone - makes authentication via token easier.
    execSync(
      `gh repo clone ${this.repo_full_name} ${this.repo_path} -- --depth=1`,
      {
        env: this.exec_env,
        stdio: 'ignore', // drop maybe large output - it's not important
      }
    )
    core.debug('Configuring git to use gh as a credential helper.')
    execSync('gh auth setup-git', {
      env: this.exec_env,
      cwd: this.repo_path,
    })
  }

  fetch(...revs: string[]): void {
    // join revs with an empty space
    const revs_str = revs.join(' ')
    core.debug(`Fetching ${revs_str}.`)
    execSync(`git fetch --depth=1 origin ${revs_str}`, {
      env: this.exec_env,
      cwd: this.repo_path,
    })
  }

  // throws an Error if the rebase fails
  rebase({head, onto}: {head: string; onto: string}): void {
    core.info(`Rebasing ${head} onto ${onto}.`)
    execSync(`git rebase --onto ${onto} ${head}`, {
      env: this.exec_env,
      cwd: this.repo_path,
    })
  }

  diff({base_sha, head_sha}: {base_sha: string; head_sha: string}): string {
    core.debug(`Generating diff between ${base_sha} and ${head_sha}.`)
    // Use spawn instead of exec here because we want to get the (potentially large)
    // output of the diff command as a string.
    // Refer to
    // https://www.hacksparrow.com/nodejs/difference-between-spawn-and-exec-of-node-js-child-rocess.html
    // for more details on using exec vs spawn.
    const result = spawnSync('git', ['diff', base_sha, head_sha], {
      env: this.exec_env,
      cwd: this.repo_path,
    })
    if (result.status !== 0) {
      core.warning(`git diff failed with status ${result.status}.`)
      core.debug(`git diff stderr:\n${result.stderr.toString()}`)
    }
    return result.stdout.toString()
  }
}
