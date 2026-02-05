// Module for git range-diff execution and output parsing
// Used to detect if PR reviews are stale by comparing commit ranges

import * as core from '@actions/core'
import {spawnSync} from 'child_process'

export interface ApprovalMetadata {
  version: number
  approved_sha: string
  merge_base_sha: string
  base_sha: string
  base_ref: string
  approved_at: string
}

export interface RangeDiffResult {
  isStale: boolean
  summary: string
}

/**
 * Parse git range-diff output to determine if reviews are stale.
 *
 * git range-diff outputs lines in the format:
 * - "N: <sha> = N: <sha> <subject>" for identical commits
 * - "N: <sha> ! N: <sha> <subject>" for modified commits (followed by diff details)
 * - "-: ------- > N: <sha> <subject>" for added commits
 * - "N: <sha> < -: ------- <subject>" for removed commits
 *
 * If the output is empty or contains only identical commits (=), the review is not stale.
 * Any modified (!), added (>), or removed (<) commits indicate the review is stale.
 */
export function parseRangeDiffOutput(output: string): RangeDiffResult {
  // Empty output means no changes between the ranges
  if (!output || output.trim() === '') {
    return {isStale: false, summary: 'No changes detected'}
  }

  const lines = output.split('\n')
  let identicalCount = 0
  let modifiedCount = 0
  let addedCount = 0
  let removedCount = 0

  for (const line of lines) {
    // Skip empty lines and diff detail lines (indented lines that follow ! markers)
    if (!line || line.startsWith(' ') || line.startsWith('\t')) {
      continue
    }

    // Match the range-diff output format
    // Format: "N: <sha> <marker> N: <sha> <subject>" or "-: ------- <marker> ..."
    // The marker is one of: =, !, <, >
    const markerMatch = line.match(
      /^\s*-?(\d+)?:\s+[0-9a-f-]+\s+([=!<>])\s+-?(\d+)?:/
    )
    if (markerMatch) {
      const marker = markerMatch[2]
      switch (marker) {
        case '=':
          identicalCount++
          break
        case '!':
          modifiedCount++
          break
        case '>':
          addedCount++
          break
        case '<':
          removedCount++
          break
      }
    }
  }

  const hasChanges = modifiedCount > 0 || addedCount > 0 || removedCount > 0

  if (hasChanges) {
    const parts: string[] = []
    if (modifiedCount > 0) parts.push(`${modifiedCount} modified`)
    if (addedCount > 0) parts.push(`${addedCount} added`)
    if (removedCount > 0) parts.push(`${removedCount} removed`)
    return {
      isStale: true,
      summary: `Commits changed: ${parts.join(', ')}`,
    }
  }

  return {
    isStale: false,
    summary:
      identicalCount > 0
        ? `${identicalCount} identical commit(s)`
        : 'No changes detected',
  }
}

/**
 * Run git range-diff to compare two commit ranges.
 *
 * @param params.repoPath - Path to the git repository
 * @param params.prevMergeBase - The merge base at the time of approval
 * @param params.approvedSha - The commit SHA that was approved
 * @param params.currMergeBase - The current merge base
 * @param params.currentHead - The current HEAD commit
 * @returns The range-diff output as a string, or null if the command failed
 */
export function runRangeDiff(params: {
  repoPath: string
  prevMergeBase: string
  approvedSha: string
  currMergeBase: string
  currentHead: string
}): string | null {
  const {repoPath, prevMergeBase, approvedSha, currMergeBase, currentHead} =
    params

  // Construct the range-diff command
  // git range-diff prevMergeBase..approvedSha currMergeBase..currentHead
  const range1 = `${prevMergeBase}..${approvedSha}`
  const range2 = `${currMergeBase}..${currentHead}`

  core.debug(`Running git range-diff ${range1} ${range2} in ${repoPath}`)

  const result = spawnSync(
    'git',
    ['range-diff', '--no-color', range1, range2],
    {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024, // 32MB buffer
    }
  )

  if (result.error) {
    const err = result.error as Error & {code?: string}
    if (err?.code === 'ENOBUFS') {
      core.warning(
        `git range-diff output exceeded buffer. Falling back to diff comparison.`
      )
    } else {
      core.warning(
        `git range-diff failed: ${err.message}${
          err.code ? ` (code: ${err.code})` : ''
        }`
      )
    }
    return null
  }

  // git range-diff returns 0 on success
  if (result.status !== 0) {
    const stderr = (result.stderr || '').toString()
    core.warning(
      `git range-diff exited with code ${result.status}. stderr:\n${stderr}`
    )
    return null
  }

  return result.stdout || ''
}
