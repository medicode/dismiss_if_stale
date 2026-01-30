import {expect, describe, test} from '@jest/globals'
import {parseRangeDiffOutput} from '../src/range-diff'

describe('parseRangeDiffOutput', () => {
  test('empty output → not stale', () => {
    expect(parseRangeDiffOutput('')).toEqual({
      isStale: false,
      summary: 'No changes detected',
    })
  })

  test('whitespace-only output → not stale', () => {
    expect(parseRangeDiffOutput('   \n  \n  ')).toEqual({
      isStale: false,
      summary: 'No changes detected',
    })
  })

  test('single identical commit (=) → not stale', () => {
    const output = '1:  abc1234 = 1:  def5678 First commit'
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(false)
    expect(result.summary).toContain('1 identical commit')
  })

  test('multiple identical commits (=) → not stale', () => {
    const output = `1:  abc1234 = 1:  def5678 First commit
2:  111aaaa = 2:  222bbbb Second commit
3:  333cccc = 3:  444dddd Third commit`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(false)
    expect(result.summary).toContain('3 identical commit')
  })

  test('modified commit (!) → stale', () => {
    const output = `1:  abc1234 ! 1:  def5678 Modified commit
    @@ Commit message
     -old message
     +new message`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('1 modified')
  })

  test('added commit (>) → stale', () => {
    const output = '-:  ------- > 1:  abc1234 New commit'
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('1 added')
  })

  test('removed commit (<) → stale', () => {
    const output = '1:  abc1234 < -:  ------- Removed commit'
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('1 removed')
  })

  test('mixed identical and modified → stale', () => {
    const output = `1:  aaa1111 = 1:  bbb1111 Keep this commit
2:  ccc2222 ! 2:  ddd2222 Changed this commit
    @@ Commit message
     -old
     +new`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('1 modified')
  })

  test('mixed added and removed → stale', () => {
    const output = `1:  abc1234 < -:  ------- Removed commit
-:  ------- > 1:  xyz9999 Added commit`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('1 added')
    expect(result.summary).toContain('1 removed')
  })

  test('all change types combined → stale', () => {
    const output = `1:  aaa1111 = 1:  bbb1111 Identical
2:  ccc2222 ! 2:  ddd2222 Modified
    @@ diff details
3:  eee3333 < -:  ------- Removed
-:  ------- > 3:  fff4444 Added`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('1 modified')
    expect(result.summary).toContain('1 added')
    expect(result.summary).toContain('1 removed')
  })

  test('multiple modifications → stale with count', () => {
    const output = `1:  aaa1111 ! 1:  bbb1111 First modified
    @@ diff
2:  ccc2222 ! 2:  ddd2222 Second modified
    @@ diff
3:  eee3333 ! 3:  fff3333 Third modified
    @@ diff`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('3 modified')
  })

  test('handles real git range-diff output format', () => {
    // This is a more realistic example of what git range-diff outputs
    // Note: Git short SHAs are hex characters (0-9, a-f)
    const output = `1:  a1b2c3d = 1:  e5f6a7b feat: add user authentication
2:  c8d9e0f ! 2:  a1b2c3d fix: resolve login bug
    @@ Commit message
     ## fix: resolve login bug

    -This fixes the login bug by checking credentials.
    +This fixes the login bug by validating credentials properly.

    -Closes #123
    +Closes #123, #456
    @@ src/auth.ts
     @@
      function login() {
    -   checkCredentials()
    +   validateCredentials()
      }
3:  d4e5f6a = 3:  b7c8d9e chore: update dependencies`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(true)
    expect(result.summary).toContain('1 modified')
  })

  test('ignores indented diff detail lines', () => {
    // Indented lines are diff details, not commit markers
    const output = `1:  abc1234 = 1:  def5678 Commit message
    This is an indented line that should be ignored
    @@ Some diff context
     +added line
     -removed line`
    const result = parseRangeDiffOutput(output)
    expect(result.isStale).toBe(false)
    expect(result.summary).toContain('1 identical commit')
  })
})
