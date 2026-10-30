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

// Twenty claims evaluated, so every fixture below that turns one count on
// still has claims that held. A run that evaluated nothing is its own arm.
const CLEAN: VerificationCounts = {
  confirmedCount: 0,
  errorCount: 0,
  unanchoredCount: 0,
  evaluatedCount: 20,
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

      expect(verdict).toEqual({
        drift: 0,
        tally: '20 claims evaluated, 20 vouched for, 0 drifted, 0 could not be read.',
        vouchedNothing: null,
        reasons: [],
        failed: false,
        failure: null,
      })
    }
  })
})

// Issue 126 item 4. `confirmedCount` is drift, so "read it and it holds" and
// "could not read any of it" both report zero, and the green badge could not
// tell them apart. `vouched` is the remainder: every evaluated claim held,
// drifted or could not be read, which is how the CLI derives it too.
describe('what the run vouched for', () => {
  it('derives vouched from the counts and prints it beside them', () => {
    // The production run issue 126 re-measured at 04728b4.
    const verdict = decideVerdict(
      counts({ evaluatedCount: 459, confirmedCount: 2, errorCount: 121 }),
      'none',
    )

    expect(verdict.tally).toBe(
      '459 claims evaluated, 336 vouched for, 2 drifted, 121 could not be read.',
    )
    expect(verdict.vouchedNothing).toBeNull()
  })

  it('says a run that evaluated no claims vouched for nothing', () => {
    const verdict = decideVerdict(counts({ evaluatedCount: 0 }), 'none')

    expect(verdict.vouchedNothing).toBe('This run vouched for nothing: it evaluated no claims.')
    expect(verdict.tally).toBe('0 claims evaluated, 0 vouched for, 0 drifted, 0 could not be read.')
  })

  it('says a run that could read none of its claims vouched for nothing', () => {
    const verdict = decideVerdict(counts({ evaluatedCount: 9, errorCount: 9 }), 'none')

    expect(verdict.tally).toBe('9 claims evaluated, 0 vouched for, 0 drifted, 9 could not be read.')
    expect(verdict.vouchedNothing).toBe(
      'This run vouched for nothing: not one of the 9 claims it evaluated could be read.',
    )
  })

  it('says so when the counts contradict each other, instead of printing a negative as a finding', () => {
    // The wire schema does not cross-validate the counts, so this parses. Reading
    // it as clean would be the defect; reading it as "nothing held" is a guess.
    const verdict = decideVerdict(counts({ evaluatedCount: 1, errorCount: 2 }), 'none')

    expect(verdict.tally).toBe('1 claim evaluated, -1 vouched for, 0 drifted, 2 could not be read.')
    expect(verdict.vouchedNothing).toContain('vouched for nothing')
    expect(verdict.vouchedNothing).toContain('do not add up (evaluated 1, drifted 0, unreadable 2)')
  })

  // The narrowing the CLI made in its own review pass. Every claim drifting
  // also leaves vouched at 0, and that run is fully informative: drift is the
  // finding, not a failure to check. A predicate true of both is the collapse
  // this whole module exists to prevent.
  it('CONTROL: a run where every evaluated claim drifted did not vouch for nothing', () => {
    const verdict = decideVerdict(counts({ evaluatedCount: 3, confirmedCount: 3 }), 'none')

    expect(verdict.tally).toBe('3 claims evaluated, 0 vouched for, 3 drifted, 0 could not be read.')
    expect(verdict.vouchedNothing).toBeNull()
  })

  it('CONTROL: one unreadable claim among readable ones is not vouched-for-nothing', () => {
    const verdict = decideVerdict(counts({ evaluatedCount: 9, errorCount: 8 }), 'none')

    expect(verdict.tally).toBe('9 claims evaluated, 1 vouched for, 0 drifted, 8 could not be read.')
    expect(verdict.vouchedNothing).toBeNull()
  })

  // The default this change keeps: no consumer's build changes colour. A run that
  // vouched for nothing is reported at every setting and fails at none of them on
  // that ground alone. `any` still fails a run that read nothing, because an
  // unreadable claim is already one of its reasons.
  it('changes no exit status: vouched-for-nothing alone fails no setting', () => {
    for (const failOn of ['none', 'drift', 'any'] as const) {
      expect(decideVerdict(counts({ evaluatedCount: 0 }), failOn).failed).toBe(false)
    }
    for (const failOn of ['none', 'drift'] as const) {
      expect(decideVerdict(counts({ evaluatedCount: 9, errorCount: 9 }), failOn).failed).toBe(false)
    }
    expect(decideVerdict(counts({ evaluatedCount: 9, errorCount: 9 }), 'any').failed).toBe(true)
  })

  it('names what it vouched for in the failure line when a run that read nothing fails', () => {
    const verdict = decideVerdict(counts({ evaluatedCount: 9, errorCount: 9 }), 'any')

    expect(verdict.failure).toBe(
      'Manual check failed: this run vouched for none of the 9 claims it evaluated, because not one of them could be read.',
    )
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

  it('prints the claim tally on every summary it writes', () => {
    const report = driftReport()
    const plan = planAnnotations(report, { repository: REPO })

    const summary = renderSummary(report, plan, decideVerdict(report, 'none'))

    expect(summary).toContain('20 claims evaluated, 19 vouched for, 1 drifted, 0 could not be read.')
  })

  // Issue 126 item 4: before this, a run that evaluated nothing wrote no summary
  // and logged "nothing this run could not vouch for", the same green as a run
  // that read every claim and found them all holding.
  it('writes a summary for a run that evaluated no claims, and says it vouched for nothing', () => {
    const report: VerificationReportView = { chapters: [], ...counts({ evaluatedCount: 0 }) }
    const plan = planAnnotations(report, { repository: REPO })

    const summary = renderSummary(report, plan, decideVerdict(report, 'none'))

    expect(summary).toContain('**This run vouched for nothing: it evaluated no claims.**')
    expect(summary).toContain('0 claims evaluated, 0 vouched for, 0 drifted, 0 could not be read.')
    expect(summary).toContain('This check is green, but not because anything was verified.')
    // "No drift found" over a run that looked at nothing is the false
    // reassurance issue 126 quotes; and no fail-on setting fails this run, so
    // naming one would promise a red that never comes.
    expect(summary).not.toContain('No drift found')
    expect(summary).not.toContain('because no claim drifted')
    expect(summary).not.toContain('fail-on')
  })

  it('heads a run that could read none of its claims with vouched-for-nothing, and keeps the reasons', () => {
    const report: VerificationReportView = {
      chapters: [],
      ...counts({ evaluatedCount: 9, errorCount: 9 }),
    }
    const plan = planAnnotations(report, { repository: REPO })

    const summary = renderSummary(report, plan, decideVerdict(report, 'none'))

    expect(summary).toContain(
      '**This run vouched for nothing: not one of the 9 claims it evaluated could be read.**',
    )
    expect(summary).toContain('9 claims could not be read at all.')
    expect(summary).toContain('This check is green, but not because anything was verified.')
    expect(summary).toContain('fail-on: any')
    expect(summary).not.toContain('No drift found')
  })

  it('ends a failed run that read nothing on the vouched-for-nothing failure line', () => {
    const report: VerificationReportView = {
      chapters: [],
      ...counts({ evaluatedCount: 9, errorCount: 9 }),
    }
    const plan = planAnnotations(report, { repository: REPO })

    const summary = renderSummary(report, plan, decideVerdict(report, 'any'))

    expect(summary.trimEnd().split('\n').at(-1)).toBe(
      'Manual check failed: this run vouched for none of the 9 claims it evaluated, because not one of them could be read.',
    )
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
