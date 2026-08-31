import { describe, expect, it, vi } from 'vitest'
import { runVerify } from './verify.js'
import type { VerificationReport } from './api.js'
import type { ActionInputs } from './inputs.js'
import type { ActionLogger } from './run.js'
import type { Annotation } from './annotate.js'
import type { FailOn } from './verdict.js'
import type { VerifyContext } from './verify-context.js'
import { ANNOTATION_LIMIT } from './annotate.js'

const REPO = 'marko-builds/deploylog'
const REF = 'd'.repeat(40)

function makeLogger() {
  const outputs: Record<string, string> = {}
  const failures: string[] = []
  const messages: string[] = []
  const warnings: string[] = []
  const annotations: Array<{ annotation: Annotation; level: string }> = []
  const summaries: string[] = []
  const logger: ActionLogger = {
    info: (m) => messages.push(m),
    warning: (m) => {
      messages.push(m)
      warnings.push(m)
    },
    debug: (m) => messages.push(m),
    setOutput: (name, value) => {
      outputs[name] = value
    },
    setFailed: (m) => failures.push(m),
    annotate: (annotation, level) => annotations.push({ annotation, level }),
    summary: (markdown) => {
      summaries.push(markdown)
    },
  }
  return { logger, outputs, failures, messages, warnings, annotations, summaries }
}

const inputs = (failOn: FailOn): ActionInputs => ({
  apiKey: 'dk_test',
  project: 'my-app',
  mode: 'verify',
  failOn,
  githubToken: '',
  aiSummarize: false,
  notifySubscribers: false,
  entryType: 'feature',
  apiUrl: 'https://deploylog.dev',
  skipPrerelease: false,
})

const context: VerifyContext = {
  repository: REPO,
  ref: REF,
  changedFiles: ['src/lib/limits.ts'],
}

/** A clean report. Every arm below turns exactly one thing on. */
function report(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    chapters: [],
    confirmedCount: 0,
    errorCount: 0,
    unanchoredCount: 0,
    evaluatedCount: 4,
    skippedCount: 0,
    lowCoverageChapters: [],
    untriggeredCount: 0,
    unverifiable: false,
    ...overrides,
  }
}

/** One drifted claim, cited in this repository, on a line that exists. */
function withDrift(): VerificationReport {
  return report({
    confirmedCount: 1,
    unverifiable: true,
    chapters: [
      {
        number: '03',
        title: 'Limits',
        state: 'CONFIRMED',
        confirmed: [
          {
            claimId: 'claim-1',
            text: 'The free plan allows 5 projects.',
            repository: REPO,
            source: 'src/lib/limits.ts',
            line: 12,
            detail: 'The manual says 5; the code says 10.',
          },
        ],
        errors: [],
        touched: ['src/lib/limits.ts'],
        coverage: { sentences: 8, measurable: 4, claimed: 4, ratio: 1, unclaimed: [] },
        untriggered: [],
      },
    ],
  })
}

/** `n` drifted claims, all in this repository, all on a line of their own. */
function withDriftCount(n: number): VerificationReport {
  return report({
    confirmedCount: n,
    unverifiable: true,
    chapters: [
      {
        number: '03',
        title: 'Limits',
        state: 'CONFIRMED',
        confirmed: Array.from({ length: n }, (_, i) => ({
          claimId: `claim-${i + 1}`,
          text: `Claim ${i + 1}.`,
          repository: REPO,
          source: 'src/lib/limits.ts',
          line: 10 + i,
          detail: `Detail ${i + 1}.`,
        })),
        errors: [],
        touched: ['src/lib/limits.ts'],
        coverage: { sentences: 8, measurable: 4, claimed: 4, ratio: 1, unclaimed: [] },
        untriggered: [],
      },
    ],
  })
}

/**
 * The issue 60 scenario: production had no GitHub App credentials, so every
 * claim failed with `not_configured`. Zero drift, nothing inline, and the only
 * information a developer needed was on the wire and nowhere in the output.
 */
function withNotConfigured(): VerificationReport {
  return report({
    errorCount: 1,
    unverifiable: true,
    chapters: [
      {
        number: '03',
        title: 'Limits',
        state: 'ERROR',
        confirmed: [],
        errors: [
          {
            claimId: 'claim-1',
            text: 'The free plan allows 5 projects.',
            repository: REPO,
            source: 'src/lib/plan.ts',
            reason: 'not_configured',
            detail:
              'Could not read src/lib/plan.ts at dd92d5c: GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set.',
          },
        ],
        touched: ['src/lib/plan.ts'],
        coverage: { sentences: 8, measurable: 4, claimed: 4, ratio: 1, unclaimed: [] },
        untriggered: [],
      },
    ],
  })
}

function runWith(rep: VerificationReport, failOn: FailOn) {
  const harness = makeLogger()
  const verifyManual = vi.fn().mockResolvedValue(rep)
  const clientFactory = () =>
    ({ verifyManual }) as unknown as ReturnType<typeof import('./api.js').createApiClient>
  return {
    ...harness,
    verifyManual,
    done: runVerify({ inputs: inputs(failOn), context, logger: harness.logger, clientFactory }),
  }
}

describe('runVerify', () => {
  it('sends the resolved context as the request body', async () => {
    const h = runWith(report(), 'none')
    await h.done
    expect(h.verifyManual).toHaveBeenCalledWith({
      project: 'my-app',
      repository: REPO,
      ref: REF,
      changedFiles: ['src/lib/limits.ts'],
    })
  })

  it('annotates drift as a warning and stays green when escalation is off', async () => {
    const h = runWith(withDrift(), 'none')
    await h.done
    expect(h.failures).toEqual([])
    expect(h.annotations).toHaveLength(1)
    expect(h.annotations[0]?.level).toBe('warning')
    expect(h.annotations[0]?.annotation).toMatchObject({ file: 'src/lib/limits.ts', line: 12 })
    // Criterion 2: green, and the finding is still visible. Visible in the
    // annotation, which is where a reachable finding lives: `renderSummary` carries
    // only what an inline annotation cannot, so asserting the manual sentence in the
    // summary would be asserting the opposite of the delivery rule.
    expect(h.annotations[0]?.annotation.message).toContain('The free plan allows 5 projects.')
    expect(h.summaries[0]).toContain('1 finding annotated inline on the changed lines.')
    expect(h.outputs['check-failed']).toBe('false')
    expect(h.outputs['drift-count']).toBe('1')
  })

  it('fails on the same finding under fail-on: drift, and turns it red', async () => {
    const h = runWith(withDrift(), 'drift')
    await h.done
    expect(h.failures).toHaveLength(1)
    expect(h.failures[0]).toContain('no longer match the code they cite')
    expect(h.annotations[0]?.level).toBe('error')
    expect(h.outputs['check-failed']).toBe('true')
  })

  it('fails under fail-on: any on errors alone, with nothing else able to cause it', async () => {
    // Criterion 4, constructed so it can only fail for the reason it names. A real
    // multi-repository manual reports its siblings untriggered on every run, so an
    // arm built on a live report would pass on `untriggeredCount` whether or not
    // the error path works at all. Every other not-clean signal is zero here.
    const errorsOnly = report({ errorCount: 2, unverifiable: true })
    expect(errorsOnly.untriggeredCount).toBe(0)
    expect(errorsOnly.unanchoredCount).toBe(0)
    expect(errorsOnly.lowCoverageChapters).toEqual([])
    expect(errorsOnly.confirmedCount).toBe(0)

    const h = runWith(errorsOnly, 'any')
    await h.done
    expect(h.failures).toHaveLength(1)
    expect(h.failures[0]).toContain('could not vouch for the manual')
    expect(h.summaries[0]).toContain('2 claims could not be read at all.')
    expect(h.annotations).toEqual([])
  })

  it('lets that same report pass under fail-on: drift', async () => {
    // The known negative for the arm above: if this also failed, that arm would be
    // a check that cannot pass, and its green sibling would prove nothing.
    const h = runWith(report({ errorCount: 2, unverifiable: true }), 'drift')
    await h.done
    expect(h.failures).toEqual([])
    expect(h.outputs['check-failed']).toBe('false')
  })

  it('attributes an untriggered-only failure to untriggered, not to errors', async () => {
    const h = runWith(report({ untriggeredCount: 3, unverifiable: true }), 'any')
    await h.done
    expect(h.failures).toHaveLength(1)
    expect(h.summaries[0]).toContain('3 claims sit in a repository')
    expect(h.summaries[0]).not.toContain('could not be read at all')
  })

  it('is silent on a clean run', async () => {
    const h = runWith(report(), 'any')
    await h.done
    expect(h.failures).toEqual([])
    expect(h.annotations).toEqual([])
    expect(h.summaries).toEqual([])
    expect(h.outputs['drift-count']).toBe('0')
  })

  it('names the not-clean reasons in the console line, not just the drift count', async () => {
    // `fail-on: none` keeps the check green, and the one line a green check shows
    // first must not read as a clean bill of health when two claims were unreadable.
    const h = runWith(report({ errorCount: 2, unverifiable: true }), 'none')
    await h.done
    expect(h.failures).toEqual([])
    expect(h.messages.join('\n')).toContain('could not vouch')
  })

  it('names the error reason, the file and the manual sentence when a claim could not be read', async () => {
    // Issue 60. The count alone ("1 claim could not be read at all") is what the
    // first live run printed, and diagnosing it took a workflow edit and a local
    // reproduction. Everything below was already in the response.
    const h = runWith(withNotConfigured(), 'none')
    await h.done
    const summary = h.summaries[0] ?? ''
    expect(summary).toContain('not_configured')
    expect(summary).toContain('src/lib/plan.ts')
    expect(summary).toContain('The free plan allows 5 projects.')
    expect(summary).toContain('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set.')
  })

  it('reports an error beside drift, never as drift', async () => {
    const h = runWith(withNotConfigured(), 'none')
    await h.done
    expect(h.outputs['drift-count']).toBe('0')
    expect(h.outputs['error-count']).toBe('1')
    expect(h.annotations).toEqual([])
  })

  it('logs one unanchored warning per error, so a green check still shows it', async () => {
    // An error has no line to annotate. The log is the other surface a green
    // check has, and the reason code belongs where a developer looks first.
    const h = runWith(withNotConfigured(), 'none')
    await h.done
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain('not_configured')
    expect(h.warnings[0]).toContain('src/lib/plan.ts')
    expect(h.annotations).toEqual([])
  })

  it('still reports check-failed when the endpoint is unreachable', async () => {
    const harness = makeLogger()
    const verifyManual = vi.fn().mockRejectedValue(new Error('429 rate limited'))
    const clientFactory = () =>
      ({ verifyManual }) as unknown as ReturnType<typeof import('./api.js').createApiClient>
    await runVerify({ inputs: inputs('none'), context, logger: harness.logger, clientFactory })
    // `none` means no FINDING fails the check, never that the check cannot fail.
    expect(harness.failures).toHaveLength(1)
    expect(harness.outputs['check-failed']).toBe('true')
    // The counts stay unset: a zero here would be a claim about the manual, and
    // this run never received one.
    expect(harness.outputs['drift-count']).toBeUndefined()
  })

  it('fails the check when the endpoint does', async () => {
    const harness = makeLogger()
    const verifyManual = vi.fn().mockRejectedValue(new Error("Project 'my-app' has no manual to verify"))
    const clientFactory = () =>
      ({ verifyManual }) as unknown as ReturnType<typeof import('./api.js').createApiClient>
    await runVerify({ inputs: inputs('none'), context, logger: harness.logger, clientFactory })
    expect(harness.failures[0]).toContain('has no manual to verify')
    expect(harness.annotations).toEqual([])
  })
})

describe('runVerify and the annotation limit', () => {
  it('emits at most the limit, however many findings the report carries', async () => {
    // The bound that matters. GitHub renders ANNOTATION_LIMIT per level per step
    // and discards the rest in silence, so emitting more does not deliver more,
    // it only makes the run believe it did.
    const h = runWith(withDriftCount(ANNOTATION_LIMIT + 7), 'none')
    await h.done
    expect(h.annotations).toHaveLength(ANNOTATION_LIMIT)
  })

  it('emits the FIRST findings, so the summary and the diff agree on which are missing', async () => {
    // renderSummary lists `annotations.slice(ANNOTATION_LIMIT)` as the ones not
    // shown. If the emit took a different subset, both halves would be true
    // separately and the pair would be a lie.
    const h = runWith(withDriftCount(ANNOTATION_LIMIT + 2), 'none')
    await h.done
    expect(h.annotations.map((a) => a.annotation.line)).toEqual(
      Array.from({ length: ANNOTATION_LIMIT }, (_, i) => 10 + i),
    )
    expect(h.summaries[0]).toContain(`Claim ${ANNOTATION_LIMIT + 1}.`)
    expect(h.summaries[0]).toContain(`Claim ${ANNOTATION_LIMIT + 2}.`)
  })

  it('emits every finding when the report is under the limit', async () => {
    // The known negative: without it, an emitter that dropped everything would
    // satisfy the bound above.
    const h = runWith(withDriftCount(ANNOTATION_LIMIT - 3), 'none')
    await h.done
    expect(h.annotations).toHaveLength(ANNOTATION_LIMIT - 3)
    expect(h.summaries[0]).not.toContain('not shown inline')
  })

  it('still reports the full drift count when the annotations are bounded', async () => {
    // The count is about the manual; the bound is about GitHub's renderer. They
    // must not be confused for one another.
    const h = runWith(withDriftCount(ANNOTATION_LIMIT + 5), 'none')
    await h.done
    expect(h.outputs['drift-count']).toBe(String(ANNOTATION_LIMIT + 5))
  })
})
