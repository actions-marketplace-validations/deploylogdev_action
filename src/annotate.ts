// Turning a manual-verification report into what a developer actually sees: an
// annotation on the line they just changed, and a job summary for everything
// that has no line to attach to.
//
// This module is pure. It decides what to render, never how to talk to GitHub,
// so the delivery rules can be tested against fixture reports without a
// workflow run. The `@actions/core` calls that consume it live at the edge.
//
// Two rules carry it.
//
// An annotation needs a reachable line. A CONFIRMED finding is scoped by the
// server to claims whose cited file is in the change, but two of them still
// cannot be pinned to a line in this run: a disappearance, where the value is
// gone and `line` is null, and a claim citing a sibling repository, which this
// checkout does not contain. Both are real findings. Neither gets guessed at a
// line it cannot reach; they go to the summary instead.
//
// The report's own `unverifiable` flag is deliberately absent from the view
// below. It is the coarse "not a clean bill of health" signal and it is not a
// drift signal, so exit status and copy come from the counts, which stay
// authoritative and separate. Leaving the field out of the type makes reading
// it by accident impossible rather than merely discouraged.

import type { VerifyErrorReason } from './api.js'

/** A claim whose cited value moved. `line` is null when the value disappeared. */
export interface ConfirmedFinding {
  claimId: string
  /** The manual sentence. The only handle every claim kind has. */
  text: string
  repository: string
  source: string
  line: number | null
  detail: string
}

/**
 * A claim the server could not read at all. Not drift: the value did not move,
 * the checker never reached it. `reason` is one of the server's nine codes and
 * `detail` is the sentence that names the cause (a missing credential, a file
 * that is not there, a symbol the claim no longer finds). An error has no line,
 * so it is never annotated; it goes to the summary with both fields intact,
 * because the count alone is what issue 60 found undiagnosable.
 */
export interface ErrorFinding {
  claimId: string
  text: string
  repository: string
  source: string
  reason: VerifyErrorReason
  detail: string
}

/**
 * `errors` is carried through on purpose; `unverifiable` is not. The first is a
 * per-claim finding a developer has to read, the second is the coarse flag the
 * view below keeps out so exit status comes from the counts.
 */
export interface ChapterFindings {
  number: string
  title: string
  confirmed: ConfirmedFinding[]
  errors: ErrorFinding[]
}

/**
 * The counts the server publishes beside its verdicts. Drift is
 * `confirmedCount`; every other count is a reason the run cannot be called
 * clean. They are read by `decideVerdict`, never collapsed into one another.
 */
export interface VerificationCounts {
  confirmedCount: number
  errorCount: number
  unanchoredCount: number
  /** Numbers of the chapters whose claim coverage is below threshold. */
  lowCoverageChapters: string[]
  untriggeredCount: number
}

/**
 * The fields of the server's `VerificationReport` this Action reads: a view,
 * not a mirror. Kept as narrow as the delivery rules need, because a second
 * copy of a contract in a second repository is how the Action came to send a
 * `null` version the server rejects (BUG-027). Source of truth is
 * `ManualVerifyResponseSchema` in `src/lib/schemas.ts` in the deploylog
 * repository — the wire contract, not the `manual-verification.ts` service type
 * this comment used to name. The route validates its report against that schema
 * on the way out precisely so the two are allowed to differ, which makes the
 * service type the wrong thing to mirror. `api.ts` holds the full mirror; this
 * stays the narrow view of it that the delivery rules read.
 */
export interface VerificationReportView extends VerificationCounts {
  chapters: ChapterFindings[]
}

/**
 * How many annotations GitHub will render, per level, per step.
 *
 * Not a preference. GitHub renders the first ten and drops the rest with no
 * error, no warning and nothing in the log, so an unbounded emit reports findings
 * as delivered that nobody will ever see. `planAnnotations` deliberately does NOT
 * apply this: it plans every finding it can place, and the bound belongs to
 * delivery, because a finding dropped before it is planned cannot be reported at
 * all — which is the defect rather than the fix.
 *
 * One constant, read by the code that emits and by the code that reports what was
 * shown. Two copies of this number is how the two sentences come to disagree.
 */
export const ANNOTATION_LIMIT = 10

export interface Annotation {
  /** Repository-relative path, as the workflow's checkout sees it. */
  file: string
  line: number
  title: string
  message: string
}

/** Why a finding could not be pinned to a line in this run. */
export type UnreachableReason = 'no_line' | 'other_repository'

export interface UnreachableFinding {
  reason: UnreachableReason
  chapter: string
  text: string
  repository: string
  source: string
  detail: string
}

/** An error finding, with the chapter it sits in. Summary only; it has no line. */
export interface ReportedError extends ErrorFinding {
  chapter: string
}

export interface AnnotationPlan {
  annotations: Annotation[]
  unreachable: UnreachableFinding[]
  /** Claims that could not be read. Listed beside drift, never counted as it. */
  errors: ReportedError[]
}

/**
 * GitHub owner and repository names are case-insensitive, and a workflow run
 * reports whatever casing the repository was registered with. Comparing raw
 * strings sends every finding to the summary and reports a run with no
 * annotations over real drift, so both sides pass through here. Mirrors
 * `canonicalSlug` in the verification service.
 */
const canonicalSlug = (repository: string) => repository.trim().toLowerCase()

export interface AnnotationContext {
  /** The `owner/repo` this workflow is running in. */
  repository: string
}

export function planAnnotations(
  report: VerificationReportView,
  context: AnnotationContext,
): AnnotationPlan {
  const here = canonicalSlug(context.repository)
  const annotations: Annotation[] = []
  const unreachable: UnreachableFinding[] = []
  const errors: ReportedError[] = []

  for (const chapter of report.chapters) {
    for (const error of chapter.errors) {
      errors.push({ ...error, chapter: chapter.number })
    }
    for (const finding of chapter.confirmed) {
      if (canonicalSlug(finding.repository) !== here) {
        unreachable.push(describe(finding, chapter, 'other_repository'))
        continue
      }
      if (finding.line === null) {
        unreachable.push(describe(finding, chapter, 'no_line'))
        continue
      }
      annotations.push({
        file: finding.source,
        line: finding.line,
        title: `Manual drift in chapter ${chapter.number}`,
        message: findingMessage(finding, chapter),
      })
    }
  }

  return { annotations, unreachable, errors }
}

function describe(
  finding: ConfirmedFinding,
  chapter: ChapterFindings,
  reason: UnreachableReason,
): UnreachableFinding {
  return {
    reason,
    chapter: chapter.number,
    text: finding.text,
    repository: finding.repository,
    source: finding.source,
    detail: finding.detail,
  }
}

function findingMessage(finding: ConfirmedFinding, chapter: ChapterFindings): string {
  return [
    'This line no longer matches what the manual says about it.',
    `Manual sentence: "${finding.text}"`,
    finding.detail,
    `Chapter ${chapter.number} "${chapter.title}", claim ${finding.claimId}.`,
  ].join('\n')
}
