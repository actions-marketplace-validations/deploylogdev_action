import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_LIMIT,
  planAnnotations,
  type VerificationCounts,
  type VerificationReportView,
} from './annotate.js'
import { DEFAULT_FAIL_ON, decideVerdict, parseFailOn, renderSummary } from './verdict.js'

/** A report with `n` drifted claims, all in this repository, all on their own line. */
function driftReportOf(n: number): VerificationReportView {
  return {
    chapters: [
      {
        number: '4',
        title: 'Plans and pricing',
        confirmed: Array.from({ length: n }, (_, i) => ({
          claimId: `claim-${i + 1}`,
          text: `Claim number ${i + 1}.`,
          repository: REPO,
          source: 'src/lib/plan.ts',
          line: 10 + i,
          detail: `Detail for claim ${i + 1}.`,
        })),
        errors: [],
      },
    ],
    ...counts({ confirmedCount: n }),
  }
}

const REPO = 'deploylogdev/action'

const CLEAN: VerificationCounts = {
  confirmedCount: 0,
  errorCount: 0,
  unanchoredCount: 0,
  lowCoverageChapters: [],
  untriggeredCount: 0,
}

function counts(overrides: Partial<VerificationCounts> = {}): VerificationCounts {
  return { ...CLEAN, ...overrides }
}

function driftReport(): VerificationReportView {
  return {
    chapters: [
      {
        number: '4',
        title: 'Plans and pricing',
        confirmed: [
          {
            claimId: 'claim-1',
            text: 'The free tier is capped at three projects.',
            repository: REPO,
            source: 'src/lib/plan.ts',
            line: 12,
            detail: 'The manual says 3. The code now reads 5.',
          },
        ],
        errors: [],
      },
    ],
    ...counts({ confirmedCount: 1 }),
  }
}

describe('decideVerdict', () => {
  it('reports drift and keeps the check green while escalation is off', () => {
    const verdict = decideVerdict(counts({ confirmedCount: 2 }), 'none')

    expect(verdict.drift).toBe(2)
    expect(verdict.failed).toBe(false)
    expect(verdict.failure).toBeNull()
  })

  it('fails the check on the same findings when escalation is on', () => {
    for (const failOn of ['drift', 'any'] as const) {
      const verdict = decideVerdict(counts({ confirmedCount: 2 }), failOn)

      expect(verdict.failed).toBe(true)
      expect(verdict.failure).toContain('2 claims')
    }
  })

  // The arm that matters. A run that could not read a single claim finds zero
  // drift, so under `drift` it is green, and it must still say loudly that it
  // could not vouch for anything. `any` is how a team that gates on this check
  // stops a broken checker from merging past it.
  it('separates could-not-check from drift, and lets `any` fail on it', () => {
    const brokenRun = counts({ errorCount: 9 })

    const underDrift = decideVerdict(brokenRun, 'drift')
    expect(underDrift.drift).toBe(0)
    expect(underDrift.failed).toBe(false)
    expect(underDrift.reasons).toHaveLength(1)
    expect(underDrift.reasons[0]).toMatchObject({ kind: 'errors', count: 9 })

    const underAny = decideVerdict(brokenRun, 'any')
    expect(underAny.failed).toBe(true)
    expect(underAny.failure).toContain('no drift was found')
  })

  it('names every count that makes a run unclean, separately', () => {
    const verdict = decideVerdict(
      counts({
        errorCount: 1,
        unanchoredCount: 2,
        lowCoverageChapters: ['3', '7'],
        untriggeredCount: 4,
      }),
      'none',
    )

    expect(verdict.reasons.map((r) => r.kind)).toEqual([
      'errors',
      'unanchored',
      'low_coverage',
      'untriggered',
    ])
    expect(verdict.reasons.map((r) => r.count)).toEqual([1, 2, 2, 4])
    expect(verdict.failed).toBe(false)
  })

  // Exit status comes from the counts, never from the report's coarse
  // `unverifiable` flag. A report carrying the flag with nothing behind it must
  // not produce a finding, which is what keeps the flag out of this decision.
  it('ignores an `unverifiable` flag that no count backs', () => {
    const flagged = { ...CLEAN, unverifiable: true } as VerificationCounts

    const verdict = decideVerdict(flagged, 'any')

    expect(verdict.reasons).toEqual([])
    expect(verdict.drift).toBe(0)
    expect(verdict.failed).toBe(false)
  })

  // The control for the whole verdict path.
  it('passes silently on a clean run under every setting', () => {
    for (const failOn of ['none', 'drift', 'any'] as const) {
      const verdict = decideVerdict(CLEAN, failOn)

      expect(verdict).toEqual({ drift: 0, reasons: [], failed: false, failure: null })
    }
  })
})

describe('parseFailOn', () => {
  it('defaults to warning only', () => {
    expect(parseFailOn('')).toBe(DEFAULT_FAIL_ON)
    expect(DEFAULT_FAIL_ON).toBe('none')
  })

  it('accepts each setting, case-insensitively', () => {
    expect(parseFailOn('none')).toBe('none')
    expect(parseFailOn(' Drift ')).toBe('drift')
    expect(parseFailOn('ANY')).toBe('any')
  })

  it('rejects anything else rather than silently warning', () => {
    expect(() => parseFailOn('true')).toThrow(/Expected one of: none, drift, any/)
  })
})

/** One claim the server could not read, and no drift. The issue 60 shape. */
function errorReport(): VerificationReportView {
  return {
    chapters: [
      {
        number: '4',
        title: 'Plans and pricing',
        confirmed: [],
        errors: [
          {
            claimId: 'claim-1',
            text: 'The free tier is capped at three projects.',
            repository: REPO,
            source: 'src/lib/plan.ts',
            reason: 'not_configured',
            detail: 'Could not read src/lib/plan.ts at dd92d5c: GITHUB_APP_ID must be set.',
          },
        ],
      },
    ],
    ...counts({ errorCount: 1 }),
  }
}

describe('renderSummary', () => {
  it('lists each unreadable claim with its reason and detail, not just the count', () => {
    const report = errorReport()
    const plan = planAnnotations(report, { repository: REPO })
    const verdict = decideVerdict(report, 'none')

    const summary = renderSummary(report, plan, verdict)

    expect(summary).toContain('1 claim could not be read at all.')
    expect(summary).toContain('`not_configured`')
    expect(summary).toContain('"The free tier is capped at three projects."')
    expect(summary).toContain(`${REPO}/src/lib/plan.ts`)
    expect(summary).toContain('GITHUB_APP_ID must be set.')
    expect(summary).toContain('No drift found.')
    expect(summary).not.toContain('Drift:')
  })

  it('prints the drift prominently even when the check stays green', () => {
    const report = driftReport()
    const plan = planAnnotations(report, { repository: REPO })
    const verdict = decideVerdict(report, 'none')

    const summary = renderSummary(report, plan, verdict)

    expect(summary).toContain('Drift: 1 claim no longer match')
    expect(summary).toContain('1 finding annotated inline')
    expect(summary).toContain('escalation is off')
    expect(summary).toContain('fail-on: drift')
  })

  it('reports a finding with no line to attach to', () => {
    const report = driftReport()
    report.chapters[0]!.confirmed[0]!.line = null
    const plan = planAnnotations(report, { repository: REPO })
    const verdict = decideVerdict(report, 'none')

    const summary = renderSummary(report, plan, verdict)

    expect(summary).toContain('1 finding with no line in this run')
    expect(summary).toContain('The free tier is capped at three projects.')
    expect(summary).toContain('0 findings annotated inline')
  })

  it('reports could-not-check under its own heading, apart from drift', () => {
    const report: VerificationReportView = { chapters: [], ...counts({ untriggeredCount: 3 }) }
    const plan = planAnnotations(report, { repository: REPO })
    const verdict = decideVerdict(report, 'none')

    const summary = renderSummary(report, plan, verdict)

    expect(summary).toContain('No drift found')
    expect(summary).toContain('could not vouch for the manual')
    expect(summary).toContain('3 claims sit in a repository no push and no sweep visits')
  })

  // The control: a clean run writes nothing at all.
  it('writes nothing for a clean run', () => {
    const report: VerificationReportView = { chapters: [], ...CLEAN }
    const plan = planAnnotations(report, { repository: REPO })

    expect(renderSummary(report, plan, decideVerdict(report, 'none'))).toBe('')
  })
})

describe('the annotation limit', () => {
  const summaryFor = (n: number) => {
    const report = driftReportOf(n)
    const plan = planAnnotations(report, { repository: REPO })
    return { plan, summary: renderSummary(report, plan, decideVerdict(report, 'none')) }
  }

  it('plans every finding, because the limit is a delivery bound and not a rule about findings', () => {
    // planAnnotations stays complete. Capping there would lose the findings before
    // anything could report them, which is the defect rather than the fix.
    expect(planAnnotations(driftReportOf(15), { repository: REPO }).annotations).toHaveLength(15)
  })

  it('says how many of how many were shown once the limit is passed', () => {
    const { summary } = summaryFor(ANNOTATION_LIMIT + 5)
    expect(summary).toContain(`${ANNOTATION_LIMIT} of ${ANNOTATION_LIMIT + 5}`)
  })

  it('lists every finding past the limit, with its line and detail', () => {
    const n = ANNOTATION_LIMIT + 3
    const { summary } = summaryFor(n)
    // The three that GitHub will not render are the ones a reader has no other
    // way to see, so each must appear whole.
    for (const i of [n - 2, n - 1, n]) {
      expect(summary).toContain(`Claim number ${i}.`)
      expect(summary).toContain(`Detail for claim ${i}.`)
      expect(summary).toContain(`src/lib/plan.ts:${10 + i - 1}`)
    }
  })

  it('does not list the findings that were shown inline', () => {
    // They are on the line already. Repeating them is how a summary becomes noise.
    const { summary } = summaryFor(ANNOTATION_LIMIT + 2)
    expect(summary).not.toContain('Claim number 1.')
  })

  it('is unchanged at exactly the limit', () => {
    const { summary } = summaryFor(ANNOTATION_LIMIT)
    expect(summary).toContain(`${ANNOTATION_LIMIT} findings annotated inline`)
    expect(summary).not.toContain(' of ')
    expect(summary).not.toContain('not shown inline')
  })

  it('is still silent on a clean run', () => {
    const report = driftReportOf(0)
    const plan = planAnnotations(report, { repository: REPO })
    expect(renderSummary(report, plan, decideVerdict(counts(), 'none'))).toBe('')
  })
})
