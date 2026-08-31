import { describe, expect, it } from 'vitest'
import {
  planAnnotations,
  type ChapterFindings,
  type ConfirmedFinding,
  type VerificationCounts,
  type VerificationReportView,
} from './annotate.js'

const REPO = 'deploylogdev/action'

function makeFinding(overrides: Partial<ConfirmedFinding> = {}): ConfirmedFinding {
  return {
    claimId: 'claim-1',
    text: 'The free tier is capped at three projects.',
    repository: REPO,
    source: 'src/lib/plan.ts',
    line: 12,
    detail: 'The manual says 3. The code now reads 5.',
    ...overrides,
  }
}

function makeChapter(
  confirmed: ConfirmedFinding[],
  overrides: Partial<ChapterFindings> = {},
): ChapterFindings {
  return { number: '4', title: 'Plans and pricing', confirmed, errors: [], ...overrides }
}

function makeReport(
  chapters: ChapterFindings[],
  counts: Partial<VerificationCounts> = {},
): VerificationReportView {
  return {
    chapters,
    confirmedCount: chapters.reduce((n, c) => n + c.confirmed.length, 0),
    errorCount: 0,
    unanchoredCount: 0,
    lowCoverageChapters: [],
    untriggeredCount: 0,
    ...counts,
  }
}

describe('planAnnotations', () => {
  it('annotates the changed source line and names the manual sentence', () => {
    const report = makeReport([makeChapter([makeFinding()])])

    const plan = planAnnotations(report, { repository: REPO })

    expect(plan.unreachable).toEqual([])
    expect(plan.annotations).toHaveLength(1)
    expect(plan.annotations[0]).toMatchObject({ file: 'src/lib/plan.ts', line: 12 })
    expect(plan.annotations[0]?.message).toContain('The free tier is capped at three projects.')
    expect(plan.annotations[0]?.message).toContain('The code now reads 5.')
    expect(plan.annotations[0]?.title).toContain('chapter 4')
  })

  it('matches the running repository regardless of casing', () => {
    // A workflow run reports whatever casing the repository was registered
    // with. Comparing raw strings would drop every finding into the summary and
    // report a run with no annotations over real drift.
    const report = makeReport([makeChapter([makeFinding({ repository: 'DeployLogDev/Action' })])])

    const plan = planAnnotations(report, { repository: REPO })

    expect(plan.annotations).toHaveLength(1)
    expect(plan.unreachable).toEqual([])
  })

  it('sends a disappearance to the summary rather than guessing a line', () => {
    const report = makeReport([makeChapter([makeFinding({ line: null })])])

    const plan = planAnnotations(report, { repository: REPO })

    expect(plan.annotations).toEqual([])
    expect(plan.unreachable).toHaveLength(1)
    expect(plan.unreachable[0]).toMatchObject({ reason: 'no_line', chapter: '4' })
  })

  it('sends a finding cited in another repository to the summary', () => {
    const report = makeReport([
      makeChapter([makeFinding({ repository: 'deploylogdev/deploylog-cli', line: 40 })]),
    ])

    const plan = planAnnotations(report, { repository: REPO })

    expect(plan.annotations).toEqual([])
    expect(plan.unreachable[0]).toMatchObject({ reason: 'other_repository' })
  })

  it('annotates findings across every chapter that carries them', () => {
    const report = makeReport([
      makeChapter([makeFinding()]),
      makeChapter([makeFinding({ claimId: 'claim-2', source: 'src/lib/stripe.ts', line: 7 })], {
        number: '5',
        title: 'Billing',
      }),
    ])

    const plan = planAnnotations(report, { repository: REPO })

    expect(plan.annotations.map((a) => a.line)).toEqual([12, 7])
  })

  // The control. A checker that cannot stay quiet on a clean run gets muted,
  // and this is the arm that proves the annotation path can produce nothing.
  it('produces no annotations and no summary entries for a report with no findings', () => {
    const report = makeReport([makeChapter([]), makeChapter([], { number: '5', title: 'Billing' })])

    const plan = planAnnotations(report, { repository: REPO })

    expect(plan).toEqual({ annotations: [], unreachable: [], errors: [] })
  })
})
