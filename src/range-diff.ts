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
  status: 'not_stale' | 'stale' | 'unknown'
  summary: string
}

const RANGE_DIFF_MARKER_PATTERN =
  /^\s*-?(\d+)?:\s+[0-9a-f-]+\s+([=!<>])\s+-?(\d+)?:/

function matchRangeDiffMarker(line: string): RegExpMatchArray | null {
  return line.match(RANGE_DIFF_MARKER_PATTERN)
}

function isRangeDiffDetailLine(line: string): boolean {
  return line === '' || line.startsWith('    ') || line.startsWith('\t')
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
 * For modified commits (!), we parse the following diff to distinguish between:
 * - Metadata-only changes (commit message, author, etc.) → not stale
 * - Actual code changes → stale
 *
 * For added (>) or removed (<) commits, we cannot determine from range-diff alone
 * whether the overall code changed (e.g., squashing commits), so we mark as stale
 * to trigger fallback to diff comparison.
 */
export function parseRangeDiffOutput(output: string): RangeDiffResult {
  // Empty output means no changes between the ranges
  if (!output || output.trim() === '') {
    return {status: 'not_stale', summary: 'No changes detected'}
  }

  const lines = output.split('\n')
  let identicalCount = 0
  let metadataOnlyCount = 0
  let codeModifiedCount = 0
  let addedCount = 0
  let removedCount = 0
  let hasUnexpectedTopLevelLine = false

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Skip empty lines
    if (!line) {
      i++
      continue
    }

    // Match the range-diff output format
    // Format: "N: <sha> <marker> N: <sha> <subject>" or "-: ------- <marker> ..."
    // The marker is one of: =, !, <, >
    //
    // Try this before treating an indented line as diff detail. Git right-aligns
    // commit indices, so marker lines can start with padding when a range contains
    // ten or more commits.
    const markerMatch = matchRangeDiffMarker(line)

    if (markerMatch) {
      const marker = markerMatch[2]
      switch (marker) {
        case '=':
          identicalCount++
          i++
          break
        case '!':
          // For ! markers, parse the following diff to check for code changes
          i++
          if (hasCodeChangesInModifiedCommit(lines, i)) {
            codeModifiedCount++
          } else {
            metadataOnlyCount++
          }
          // Skip details up to the next marker line. The next marker may itself be
          // indented for column alignment. Stop on unexpected top-level content so
          // the main loop can mark the output as only partially parsed.
          while (
            i < lines.length &&
            !matchRangeDiffMarker(lines[i]) &&
            isRangeDiffDetailLine(lines[i])
          ) {
            i++
          }
          break
        case '>':
          addedCount++
          i++
          break
        case '<':
          removedCount++
          i++
          break
        default:
          i++
      }
    } else {
      if (!isRangeDiffDetailLine(line)) {
        hasUnexpectedTopLevelLine = true
      }
      i++
    }
  }

  const recognizedCount =
    identicalCount +
    metadataOnlyCount +
    codeModifiedCount +
    addedCount +
    removedCount

  // A non-empty range-diff that is wholly or partially unrecognized is not proof
  // that the ranges are equivalent. Fall back to the full diff comparison.
  if (recognizedCount === 0 || hasUnexpectedTopLevelLine) {
    return {
      status: 'unknown',
      summary: 'Unable to parse range-diff output; checking diff',
    }
  }

  // Determine staleness:
  // - Code-modified commits (! with file changes) → definitely stale
  // - Added/removed commits (>/<) → unknown, need fallback to diff comparison
  // - Metadata-only (! with only message changes) or identical (=) → not stale

  // If there are code changes in modified commits, it's definitely stale
  if (codeModifiedCount > 0) {
    const parts: string[] = [`${codeModifiedCount} with code changes`]
    if (addedCount > 0) parts.push(`${addedCount} added`)
    if (removedCount > 0) parts.push(`${removedCount} removed`)
    return {
      status: 'stale',
      summary: `Commits changed: ${parts.join(', ')}`,
    }
  }

  // If there are added/removed commits but no code-modified commits,
  // we can't determine staleness from range-diff alone (e.g., squash/split)
  if (addedCount > 0 || removedCount > 0) {
    const parts: string[] = []
    if (addedCount > 0) parts.push(`${addedCount} added`)
    if (removedCount > 0) parts.push(`${removedCount} removed`)
    return {
      status: 'unknown',
      summary: `Commit structure changed: ${parts.join(', ')}; checking diff`,
    }
  }

  // Only identical or metadata-only modified commits
  const unchangedCount = identicalCount + metadataOnlyCount
  return {
    status: 'not_stale',
    summary:
      unchangedCount > 0
        ? `${unchangedCount} commit(s) with no code changes`
        : 'No changes detected',
  }
}

/**
 * Check if a modified commit (!) has actual code changes vs just metadata changes.
 *
 * In git range-diff output, modified commits are followed by indented diff lines:
 * - "@@ Commit message" indicates commit message changes (metadata)
 * - "@@ <filename>" or "@@ <filename> @@" indicates file changes (code)
 *
 * @param lines All lines from range-diff output
 * @param startIndex Index to start scanning from (first line after ! marker)
 * @returns true if there are code changes, false if only metadata changes
 */
function hasCodeChangesInModifiedCommit(
  lines: string[],
  startIndex: number
): boolean {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]

    // Stop at the next commit marker, including markers indented by Git for
    // column alignment, or at any unexpected top-level line.
    if (matchRangeDiffMarker(line) || !isRangeDiffDetailLine(line)) {
      break
    }

    // Look for @@ markers that indicate what section changed
    // Format: "    @@ <section> @@" or "    @@ <section>"
    // "Commit message" is metadata; anything else (file paths) is code
    const sectionMatch = line.match(/^\s+@@\s+(.+?)(?:\s+@@|$)/)
    if (sectionMatch) {
      const section = sectionMatch[1].trim()
      if (section !== 'Commit message' && section !== 'Metadata') {
        return true
      }
    }
  }

  return false
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
