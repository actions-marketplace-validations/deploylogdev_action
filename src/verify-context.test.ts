import { describe, expect, it, vi } from 'vitest'
import {
  CHANGED_FILE_CAP,
  collectChangedPaths,
  resolveVerifyContext,
  toWorkflowRun,
  type PullRequestFile,
  type WorkflowRun,
} from './verify-context.js'

const HEAD = 'b'.repeat(40)
const MERGE = 'c'.repeat(40)

function makeLogger() {
  const infos: string[] = []
  const warnings: string[] = []
  return { info: (m: string) => infos.push(m), warning: (m: string) => warnings.push(m), infos, warnings }
}

const pullRun: WorkflowRun = {
  repository: 'marko-builds/deploylog',
  eventName: 'pull_request',
  sha: MERGE,
  pullRequest: { number: 7, headSha: HEAD },
}

function listing(files: PullRequestFile[]) {
  return vi.fn().mockResolvedValue(files)
}

describe('collectChangedPaths', () => {
  it('returns both names of a renamed file', async () => {
    const result = await collectChangedPaths(
      listing([{ filename: 'src/lib/limits.ts', previous_filename: 'src/limits.ts' }]),
      7,
    )
    expect(result).toEqual({ kind: 'paths', paths: expect.any(Array) })
    expect(result.kind === 'paths' && result.paths.sort()).toEqual([
      'src/lib/limits.ts',
      'src/limits.ts',
    ])
  })

  it('refuses a list at the cap rather than returning a partial one', async () => {
    const files = Array.from({ length: CHANGED_FILE_CAP }, (_, i) => ({ filename: `f${i}.ts` }))
    expect(await collectChangedPaths(listing(files), 7)).toEqual({ kind: 'untrusted', reason: 'cap' })
  })

  it('returns a list one file below the cap', async () => {
    // The known negative for the arm above: without it, `collectChangedPaths`
    // could refuse everything and still pass the cap test.
    const files = Array.from({ length: CHANGED_FILE_CAP - 1 }, (_, i) => ({ filename: `f${i}.ts` }))
    const result = await collectChangedPaths(listing(files), 7)
    expect(result.kind).toBe('paths')
    expect(result.kind === 'paths' && result.paths).toHaveLength(CHANGED_FILE_CAP - 1)
  })

  it('refuses an empty listing rather than scoping the run to nothing', async () => {
    expect(await collectChangedPaths(listing([]), 7)).toEqual({ kind: 'untrusted', reason: 'empty' })
  })
})

describe('toWorkflowRun', () => {
  const event = {
    repository: 'marko-builds/deploylog',
    eventName: 'pull_request',
    sha: MERGE,
    pullRequest: { number: 7, head: { sha: HEAD } },
  }

  it('carries the head sha through', () => {
    expect(toWorkflowRun(event).pullRequest).toEqual({ number: 7, headSha: HEAD })
  })

  it('refuses a pull request with no head sha instead of falling back to the merge commit', () => {
    // The whole point: the fallback would be `sha`, which on a pull request is
    // the merge commit, and every annotation computed there is silently dropped.
    expect(() => toWorkflowRun({ ...event, pullRequest: { number: 7, head: {} } })).toThrow(
      /no head sha/,
    )
    expect(() => toWorkflowRun({ ...event, pullRequest: { number: 7 } })).toThrow(/merge commit/)
  })

  it('leaves a non-pull-request event with no pull request', () => {
    const run = toWorkflowRun({ ...event, eventName: 'push', pullRequest: undefined })
    expect(run.pullRequest).toBeNull()
    expect(run.sha).toBe(MERGE)
  })
})

describe('resolveVerifyContext', () => {
  it('pins the ref to the pull request head, not the merge commit', async () => {
    const ctx = await resolveVerifyContext(pullRun, listing([{ filename: 'a.ts' }]), makeLogger())
    expect(ctx.ref).toBe(HEAD)
    expect(ctx.ref).not.toBe(MERGE)
    expect(ctx.changedFiles).toEqual(['a.ts'])
    expect(ctx.repository).toBe('marko-builds/deploylog')
  })

  it('sweeps the whole manual on a non-pull-request event', async () => {
    const logger = makeLogger()
    const ctx = await resolveVerifyContext(
      { ...pullRun, eventName: 'push', pullRequest: null },
      null,
      logger,
    )
    expect(ctx.ref).toBe(MERGE)
    expect(ctx.changedFiles).toBeNull()
    expect(logger.infos.join('\n')).toContain('whole manual')
  })

  it('sweeps and warns when no token was supplied on a pull request', async () => {
    const logger = makeLogger()
    const ctx = await resolveVerifyContext(pullRun, null, logger)
    expect(ctx.changedFiles).toBeNull()
    expect(logger.warnings.join('\n')).toContain('github-token')
  })

  it('sweeps and names the empty case when the pull request reports no files', async () => {
    const logger = makeLogger()
    const ctx = await resolveVerifyContext(pullRun, listing([]), logger)
    expect(ctx.changedFiles).toBeNull()
    expect(logger.warnings.join('\n')).toContain('no changed files')
  })

  it('sweeps and names the cap case distinctly', async () => {
    const logger = makeLogger()
    const files = Array.from({ length: CHANGED_FILE_CAP }, (_, i) => ({ filename: `f${i}.ts` }))
    const ctx = await resolveVerifyContext(pullRun, listing(files), logger)
    expect(ctx.changedFiles).toBeNull()
    expect(logger.warnings.join('\n')).toContain('at least')
    expect(logger.warnings.join('\n')).not.toContain('no changed files')
  })

  it('sweeps and warns when the files API fails', async () => {
    const logger = makeLogger()
    const failing = vi.fn().mockRejectedValue(new Error('Resource not accessible by integration'))
    const ctx = await resolveVerifyContext(pullRun, failing, logger)
    expect(ctx.changedFiles).toBeNull()
    expect(logger.warnings.join('\n')).toContain('Resource not accessible by integration')
  })

  it('refuses a ref that is not a full sha', async () => {
    await expect(
      resolveVerifyContext(
        { ...pullRun, pullRequest: null, sha: 'main' },
        null,
        makeLogger(),
      ),
    ).rejects.toThrow(/40-character sha/)
  })
})
