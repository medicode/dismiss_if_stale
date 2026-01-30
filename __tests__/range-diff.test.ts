import {expect, describe, test} from '@jest/globals'
import {parseRangeDiffOutput} from '../src/range-diff'

describe('parseRangeDiffOutput', () => {
  test('empty output → not stale', () => {
    expect(parseRangeDiffOutput('')).toEqual({
      status: 'not_stale',
      summary: 'No changes detected',
    })
  })

  test('whitespace-only output → not stale', () => {
    expect(parseRangeDiffOutput('   \n  \n  ')).toEqual({
      status: 'not_stale',
      summary: 'No changes detected',
    })
  })

  test('single identical commit (=) → not stale', () => {
    const output = '1:  abc1234 = 1:  def5678 First commit'
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('1 commit')
    expect(result.summary).toContain('no code changes')
  })

  test('multiple identical commits (=) → not stale', () => {
    const output = `1:  abc1234 = 1:  def5678 First commit
2:  111aaaa = 2:  222bbbb Second commit
3:  333cccc = 3:  444dddd Third commit`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('3 commit')
    expect(result.summary).toContain('no code changes')
  })

  test('modified commit with only commit message change (!) → not stale', () => {
    const output = `1:  abc1234 ! 1:  def5678 Modified commit
    @@ Commit message
     ## Modified commit ##

    -old message body
    +new message body`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('no code changes')
  })

  test('modified commit with code change (!) → stale', () => {
    const output = `1:  abc1234 ! 1:  def5678 Modified commit
    @@ Commit message
     ## Modified commit ##

    -old message
    +new message
    @@ src/file.ts @@
      function foo() {
    -   oldCode()
    +   newCode()
      }`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('stale')
    expect(result.summary).toContain('1 with code changes')
  })

  test('added commit (>) → unknown (needs fallback)', () => {
    const output = '-:  ------- > 1:  abc1234 New commit'
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('unknown')
    expect(result.summary).toContain('1 added')
  })

  test('removed commit (<) → unknown (needs fallback)', () => {
    const output = '1:  abc1234 < -:  ------- Removed commit'
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('unknown')
    expect(result.summary).toContain('1 removed')
  })

  test('identical + metadata-only modified → not stale', () => {
    const output = `1:  aaa1111 = 1:  bbb1111 Keep this commit
2:  ccc2222 ! 2:  ddd2222 Changed message only
    @@ Commit message
     -old
     +new`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('2 commit')
    expect(result.summary).toContain('no code changes')
  })

  test('identical + code-modified → stale', () => {
    const output = `1:  aaa1111 = 1:  bbb1111 Keep this commit
2:  ccc2222 ! 2:  ddd2222 Changed code
    @@ src/index.ts @@
     -old
     +new`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('stale')
    expect(result.summary).toContain('1 with code changes')
  })

  test('mixed added and removed → unknown (needs fallback)', () => {
    const output = `1:  abc1234 < -:  ------- Removed commit
-:  ------- > 1:  xyz9999 Added commit`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('unknown')
    expect(result.summary).toContain('1 added')
    expect(result.summary).toContain('1 removed')
  })

  test('code-modified + added/removed → stale (code change takes precedence)', () => {
    const output = `1:  aaa1111 = 1:  bbb1111 Identical
2:  ccc2222 ! 2:  ddd2222 Code modified
    @@ src/file.ts @@
     -old
     +new
3:  eee3333 < -:  ------- Removed
-:  ------- > 3:  fff4444 Added`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('stale')
    expect(result.summary).toContain('1 with code changes')
    expect(result.summary).toContain('1 added')
    expect(result.summary).toContain('1 removed')
  })

  test('multiple code modifications → stale with count', () => {
    const output = `1:  aaa1111 ! 1:  bbb1111 First modified
    @@ src/a.ts @@
     -old
     +new
2:  ccc2222 ! 2:  ddd2222 Second modified
    @@ src/b.ts @@
     -old
     +new
3:  eee3333 ! 3:  fff3333 Third modified
    @@ src/c.ts @@
     -old
     +new`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('stale')
    expect(result.summary).toContain('3 with code changes')
  })

  test('multiple metadata-only modifications → not stale', () => {
    const output = `1:  aaa1111 ! 1:  bbb1111 First modified
    @@ Commit message
     -old msg
     +new msg
2:  ccc2222 ! 2:  ddd2222 Second modified
    @@ Commit message
     -old msg
     +new msg`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('2 commit')
    expect(result.summary).toContain('no code changes')
  })

  test('handles real git range-diff output with code changes', () => {
    const output = `1:  a1b2c3d = 1:  e5f6a7b feat: add user authentication
2:  c8d9e0f ! 2:  a1b2c3d fix: resolve login bug
    @@ Commit message
     ## fix: resolve login bug

    -This fixes the login bug by checking credentials.
    +This fixes the login bug by validating credentials properly.

    -Closes #123
    +Closes #123, #456
    @@ src/auth.ts @@
      function login() {
    -   checkCredentials()
    +   validateCredentials()
      }
3:  d4e5f6a = 3:  b7c8d9e chore: update dependencies`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('stale')
    expect(result.summary).toContain('1 with code changes')
  })

  test('handles real git range-diff output with only message changes', () => {
    const output = `1:  a1b2c3d = 1:  e5f6a7b feat: add user authentication
2:  c8d9e0f ! 2:  a1b2c3d fix: resolve login bug
    @@ Commit message
     ## fix: resolve login bug

    -This fixes the login bug by checking credentials.
    +This fixes the login bug by validating credentials properly.

    -Closes #123
    +Closes #123, #456
3:  d4e5f6a = 3:  b7c8d9e chore: update dependencies`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('3 commit')
    expect(result.summary).toContain('no code changes')
  })

  test('ignores indented diff detail lines for identical commits', () => {
    // Indented lines are diff details, not commit markers
    const output = `1:  abc1234 = 1:  def5678 Commit message
    This is an indented line that should be ignored
    @@ Some diff context
     +added line
     -removed line`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('not_stale')
    expect(result.summary).toContain('1 commit')
    expect(result.summary).toContain('no code changes')
  })

  test('detects code change when file path contains spaces', () => {
    const output = `1:  abc1234 ! 1:  def5678 Fix bug
    @@ src/my file.ts @@
     -old
     +new`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('stale')
    expect(result.summary).toContain('1 with code changes')
  })

  test('detects code change with various file extensions', () => {
    const output = `1:  abc1234 ! 1:  def5678 Fix bug
    @@ package.json @@
     -old
     +new`
    const result = parseRangeDiffOutput(output)
    expect(result.status).toBe('stale')
    expect(result.summary).toContain('1 with code changes')
  })
})
