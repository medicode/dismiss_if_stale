import {expect, describe, test, beforeEach, afterEach} from '@jest/globals'
import {execSync} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {runRangeDiff, parseRangeDiffOutput} from '../src/range-diff'

/**
 * Integration tests for git range-diff functionality.
 *
 * These tests create real git repositories with specific commit scenarios
 * to verify that runRangeDiff and parseRangeDiffOutput work correctly
 * with actual git output.
 */
describe('range-diff integration', () => {
  let repoPath: string

  beforeEach(() => {
    // Create temp directory for test repo
    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'range-diff-test-'))
    execSync('git init -b main', {cwd: repoPath, stdio: 'ignore'})
    execSync('git config user.email "test@test.com"', {cwd: repoPath})
    execSync('git config user.name "Test User"', {cwd: repoPath})
    // Create initial commit on main
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repo\n')
    execSync('git add README.md', {cwd: repoPath})
    execSync('git commit -m "Initial commit"', {cwd: repoPath, stdio: 'ignore'})
  })

  afterEach(() => {
    fs.rmSync(repoPath, {recursive: true, force: true})
  })

  /**
   * Helper to get the current HEAD SHA
   */
  function getHead(): string {
    return execSync('git rev-parse HEAD', {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim()
  }

  /**
   * Helper to get merge base between two refs
   */
  function getMergeBase(ref1: string, ref2: string): string {
    return execSync(`git merge-base ${ref1} ${ref2}`, {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim()
  }

  /**
   * Helper to create a file and commit it
   */
  function commitFile({
    filename,
    content,
    message,
  }: {
    filename: string
    content: string
    message: string
  }): string {
    fs.writeFileSync(path.join(repoPath, filename), content)
    execSync(`git add ${filename}`, {cwd: repoPath})
    execSync(`git commit -m "${message}"`, {cwd: repoPath, stdio: 'ignore'})
    return getHead()
  }

  /**
   * Helper to run range-diff and parse the result
   */
  function runAndParse({
    prevMergeBase,
    approvedSha,
    currMergeBase,
    currentHead,
  }: {
    prevMergeBase: string
    approvedSha: string
    currMergeBase: string
    currentHead: string
  }) {
    const output = runRangeDiff({
      repoPath,
      prevMergeBase,
      approvedSha,
      currMergeBase,
      currentHead,
    })
    expect(output).not.toBeNull()
    return parseRangeDiffOutput(output!)
  }

  test('identical commits (no changes) → not_stale', () => {
    // Setup:
    // main: A
    // branch: A -> B (feature)
    // After "rebase" (no actual change since main hasn't moved): A -> B
    // Range-diff should show B = B (identical)

    const mainSha = getHead()

    // Create feature branch with one commit
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const featureSha = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })

    // Get merge base (should be mainSha)
    const mergeBase = getMergeBase('main', 'feature')
    expect(mergeBase).toBe(mainSha)

    // Range-diff comparing the same range to itself
    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha: featureSha,
      currMergeBase: mergeBase,
      currentHead: featureSha,
    })

    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('no code changes')
  })

  test('rebase onto updated main (no code changes) → not_stale', () => {
    // Setup:
    // main: A -> C (new commit on main)
    // branch before: A -> B
    // branch after rebase: C -> B' (B rebased onto C)
    // Range-diff should show B = B' (same patch, different base)

    const initialMain = getHead()

    // Create feature branch with one commit
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const originalFeatureSha = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })
    const originalMergeBase = getMergeBase('main', 'feature')

    // Go back to main and add a commit
    execSync('git checkout main', {cwd: repoPath, stdio: 'ignore'})
    commitFile({
      filename: 'other.ts',
      content: 'export const y = 2;\n',
      message: 'Add other file',
    })

    // Rebase feature onto main
    execSync('git checkout feature', {cwd: repoPath, stdio: 'ignore'})
    execSync('git rebase main', {cwd: repoPath, stdio: 'ignore'})

    const rebasedFeatureSha = getHead()
    const newMergeBase = getMergeBase('main', 'feature')

    // The commit SHAs should be different (rebased)
    expect(rebasedFeatureSha).not.toBe(originalFeatureSha)

    // But range-diff should show they're equivalent
    const result = runAndParse({
      prevMergeBase: originalMergeBase,
      approvedSha: originalFeatureSha,
      currMergeBase: newMergeBase,
      currentHead: rebasedFeatureSha,
    })

    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('no code changes')
  })

  test('commit message amended only → not_stale', () => {
    // Setup:
    // branch before: A -> B (message: "Add feature")
    // branch after: A -> B' (message: "Add feature - improved description")
    // Range-diff should show B ! B' with only Commit message changes

    const mainSha = getHead()

    // Create feature branch with one commit
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const originalSha = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })
    const mergeBase = getMergeBase('main', 'feature')

    // Amend the commit message only
    execSync('git commit --amend -m "Add feature - improved description"', {
      cwd: repoPath,
      stdio: 'ignore',
    })
    const amendedSha = getHead()

    // SHAs should be different
    expect(amendedSha).not.toBe(originalSha)

    // Range-diff should show not stale (only message changed)
    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha: originalSha,
      currMergeBase: mergeBase,
      currentHead: amendedSha,
    })

    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('no code changes')
  })

  test('code change in amended commit → stale or unknown', () => {
    // Setup:
    // branch before: A -> B (code: x = 1)
    // branch after: A -> B' (code: x = 2)
    //
    // Git range-diff may show this as:
    // - '!' (modified) with file changes → status: 'stale'
    // - '<' and '>' (removed/added) if patches differ too much → status: 'unknown'
    //
    // Both are acceptable — either way, the action falls back to full diff
    // comparison to verify (range-diff only short-circuits on 'not_stale').

    const mainSha = getHead()

    // Create feature branch with one commit
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const originalSha = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })
    const mergeBase = getMergeBase('main', 'feature')

    // Create a backup branch to preserve the original commit
    execSync('git branch feature-backup', {cwd: repoPath, stdio: 'ignore'})

    // Amend with code change
    fs.writeFileSync(path.join(repoPath, 'feature.ts'), 'export const x = 2;\n')
    execSync('git add feature.ts', {cwd: repoPath})
    execSync('git commit --amend -m "Add feature"', {
      cwd: repoPath,
      stdio: 'ignore',
    })
    const amendedSha = getHead()

    // Range-diff should NOT return not_stale (code definitely changed)
    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha: originalSha,
      currMergeBase: mergeBase,
      currentHead: amendedSha,
    })

    // Either 'stale' (git matched commits and found code changes) or
    // 'unknown' (git couldn't match commits, needs fallback)
    expect(['stale', 'unknown']).toContain(result.status)
    expect(result.status).not.toBe('not_stale')
  })

  test('new commit added → unknown', () => {
    // Setup:
    // branch before: A -> B
    // branch after: A -> B -> C (new commit)
    // Range-diff should show B = B, and C as added (>)

    const mainSha = getHead()

    // Create feature branch with one commit
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const firstCommit = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })
    const mergeBase = getMergeBase('main', 'feature')

    // Store the "approved" state
    const approvedSha = firstCommit

    // Add another commit
    const secondCommit = commitFile({
      filename: 'feature2.ts',
      content: 'export const y = 2;\n',
      message: 'Add second feature',
    })

    // Range-diff should show unknown (new commit added)
    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha,
      currMergeBase: mergeBase,
      currentHead: secondCommit,
    })

    expect(result.status).toBe('unknown')
    expect(result.summary).toContain('added')
  })

  test('commit removed → unknown', () => {
    // Setup:
    // branch before: A -> B -> C
    // branch after: A -> B (C removed via reset)
    // Range-diff should show C as removed (<)

    const mainSha = getHead()

    // Create feature branch with two commits
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const firstCommit = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })
    const secondCommit = commitFile({
      filename: 'feature2.ts',
      content: 'export const y = 2;\n',
      message: 'Add second feature',
    })
    const mergeBase = getMergeBase('main', 'feature')

    // Store the "approved" state with both commits
    const approvedSha = secondCommit

    // Remove the second commit
    execSync('git reset --hard HEAD~1', {cwd: repoPath, stdio: 'ignore'})
    const currentHead = getHead()
    expect(currentHead).toBe(firstCommit)

    // Range-diff should show unknown (commit removed)
    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha,
      currMergeBase: mergeBase,
      currentHead,
    })

    expect(result.status).toBe('unknown')
    expect(result.summary).toContain('removed')
  })

  test('commits squashed → unknown', () => {
    // Setup:
    // branch before: A -> B -> C
    // branch after: A -> BC (squashed)
    // Range-diff should show B and C removed, BC added

    const mainSha = getHead()

    // Create feature branch with two commits
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })
    const secondCommit = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\nexport const y = 2;\n',
      message: 'Extend feature',
    })
    const mergeBase = getMergeBase('main', 'feature')
    const approvedSha = secondCommit

    // Squash the two commits into one
    execSync('git reset --soft HEAD~2', {cwd: repoPath, stdio: 'ignore'})
    execSync('git commit -m "Add feature (squashed)"', {
      cwd: repoPath,
      stdio: 'ignore',
    })
    const squashedSha = getHead()

    // Range-diff should show unknown (commits restructured)
    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha,
      currMergeBase: mergeBase,
      currentHead: squashedSha,
    })

    expect(result.status).toBe('unknown')
    // Could have added/removed markers depending on how git matches them
    expect(['added', 'removed'].some(s => result.summary.includes(s))).toBe(
      true
    )
  })

  test('commit reordered → depends on git matching', () => {
    // Setup:
    // branch before: A -> B -> C
    // branch after: A -> C' -> B' (reordered)
    // Range-diff behavior depends on whether git can match the commits

    const mainSha = getHead()

    // Create feature branch with two commits
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const commitB = commitFile({
      filename: 'b.ts',
      content: 'export const b = 1;\n',
      message: 'Add B',
    })
    const commitC = commitFile({
      filename: 'c.ts',
      content: 'export const c = 1;\n',
      message: 'Add C',
    })
    const mergeBase = getMergeBase('main', 'feature')
    const approvedSha = commitC

    // Reorder: reset and cherry-pick in reverse order
    execSync(`git reset --hard ${mergeBase}`, {cwd: repoPath, stdio: 'ignore'})
    execSync(`git cherry-pick ${commitC}`, {cwd: repoPath, stdio: 'ignore'})
    execSync(`git cherry-pick ${commitB}`, {cwd: repoPath, stdio: 'ignore'})
    const reorderedHead = getHead()

    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha,
      currMergeBase: mergeBase,
      currentHead: reorderedHead,
    })

    // Git may match the commits as modified (!) or show them as add/remove
    // Either way, if there are no actual code changes in the patches themselves,
    // the result should reflect that
    expect(['not_stale', 'unknown'].includes(result.status)).toBe(true)
  })

  test('multiple commits with code change in last commit → stale or unknown', () => {
    // Setup:
    // branch before: A -> B -> C -> D
    // branch after amend: A -> B -> C -> D' (D has code change)
    //
    // Git may show D/D' as modified (!) or as add/remove if patches differ too much.
    // Either way, the result should NOT be 'not_stale'.

    const mainSha = getHead()

    // Create feature branch with multiple commits
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    commitFile({
      filename: 'b.ts',
      content: 'export const b = 1;\n',
      message: 'Add B',
    })
    commitFile({
      filename: 'c.ts',
      content: 'export const c = 1;\n',
      message: 'Add C',
    })
    const commitD = commitFile({
      filename: 'd.ts',
      content: 'export const d = 1;\n',
      message: 'Add D',
    })
    const mergeBase = getMergeBase('main', 'feature')
    const approvedSha = commitD

    // Create a backup branch to preserve the original commits
    execSync('git branch feature-backup', {cwd: repoPath, stdio: 'ignore'})

    // Make changes: amend D with code change
    fs.writeFileSync(path.join(repoPath, 'd.ts'), 'export const d = 999;\n')
    execSync('git add d.ts', {cwd: repoPath})
    execSync('git commit --amend -m "Add D (modified)"', {
      cwd: repoPath,
      stdio: 'ignore',
    })
    const modifiedHead = getHead()

    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha,
      currMergeBase: mergeBase,
      currentHead: modifiedHead,
    })

    // Should NOT be not_stale (code definitely changed)
    expect(['stale', 'unknown']).toContain(result.status)
    expect(result.status).not.toBe('not_stale')
  })

  test('code change then revert → range-diff says stale but net diff unchanged', () => {
    // This is the key scenario motivating why range-diff 'stale' should NOT
    // short-circuit dismissal. Range-diff operates per-commit, so it sees
    // code changes in B' and C'. But the net diff (what the reviewer sees)
    // is identical because C' reverts B's change.
    //
    // Setup:
    // branch before (approved): A → B (adds feature.ts with x=1)
    // branch after:             A → B' (changes x=1 to x=2) → C' (reverts x=2 back to x=1)
    //
    // Range-diff: B vs B' shows code change → 'stale' or 'unknown'
    // But net diff: identical (feature.ts still has x=1)

    const mainSha = getHead()

    // Create feature branch with one commit (the approved state)
    execSync('git checkout -b feature', {cwd: repoPath, stdio: 'ignore'})
    const originalSha = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Add feature',
    })
    const mergeBase = getMergeBase('main', 'feature')

    // Preserve the approved state on a backup branch
    execSync('git branch feature-approved', {cwd: repoPath, stdio: 'ignore'})

    // Now simulate the developer amending and adding commits:
    // First, amend the original commit with a code change (x=1 → x=2)
    fs.writeFileSync(path.join(repoPath, 'feature.ts'), 'export const x = 2;\n')
    execSync('git add feature.ts', {cwd: repoPath})
    execSync('git commit --amend -m "Add feature (modified)"', {
      cwd: repoPath,
      stdio: 'ignore',
    })

    // Then add a new commit that reverts the change (x=2 → x=1)
    const currentHead = commitFile({
      filename: 'feature.ts',
      content: 'export const x = 1;\n',
      message: 'Revert feature change',
    })

    // Range-diff should NOT return 'not_stale' because it sees per-commit changes
    const result = runAndParse({
      prevMergeBase: mergeBase,
      approvedSha: originalSha,
      currMergeBase: mergeBase,
      currentHead,
    })
    expect(result.status).not.toBe('not_stale')

    // But the net diff IS the same — this is why we fall back to diff comparison
    // instead of dismissing based on range-diff 'stale' alone.
    // Verify the net content matches the approved state:
    const approvedContent = execSync(`git show feature-approved:feature.ts`, {
      cwd: repoPath,
      encoding: 'utf8',
    })
    const currentContent = execSync(`git show feature:feature.ts`, {
      cwd: repoPath,
      encoding: 'utf8',
    })
    expect(currentContent).toBe(approvedContent)
  })

  test('handles empty range (no commits in range) → runRangeDiff returns null', () => {
    // Git range-diff fails when ranges are empty (same start and end SHA).
    // This is expected - git says "need two commit ranges".
    // Our code handles this by returning null, which triggers fallback.
    const mainSha = getHead()

    const output = runRangeDiff({
      repoPath,
      prevMergeBase: mainSha,
      approvedSha: mainSha,
      currMergeBase: mainSha,
      currentHead: mainSha,
    })

    // Git fails with empty ranges, so we return null (triggers fallback)
    expect(output).toBeNull()
  })

  test('runRangeDiff returns null for invalid refs', () => {
    const output = runRangeDiff({
      repoPath,
      prevMergeBase: 'nonexistent1',
      approvedSha: 'nonexistent2',
      currMergeBase: 'nonexistent3',
      currentHead: 'nonexistent4',
    })

    expect(output).toBeNull()
  })

  test('runRangeDiff returns null for non-git directory', () => {
    const nonGitPath = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'))

    try {
      const output = runRangeDiff({
        repoPath: nonGitPath,
        prevMergeBase: 'abc123',
        approvedSha: 'def456',
        currMergeBase: 'abc123',
        currentHead: 'ghi789',
      })

      expect(output).toBeNull()
    } finally {
      fs.rmSync(nonGitPath, {recursive: true, force: true})
    }
  })
})
