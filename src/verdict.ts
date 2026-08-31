// What a verification run concludes, and whether it fails the check.
//
// The governing rule, from the deploylog wiki record "What `unverifiable`
// means, and why a sweep is a list of repositories": exit status and copy come
// from the counts, not from the report's `unverifiable` flag. Drift is
// `confirmedCount`. Everything else is a reason the run cannot be called clean,
// and the two never collapse into each other, because collapsing them is how a
// broken checker reads as a clean one.
//
// Escalation is one input with three settings rather than a boolean, and the
// reason is the middle case. Under a boolean, a run that could not read a
// single claim reports zero drift and therefore exits green in every
// configuration there is, which relocates the failure the separation exists to
// prevent: a team that came to trust the check enough to gate on it merges past
// a checker that is simply broken. `any` is how that team says so. The three
// settings select which signals fail the check; they never merge them, and both
// are reported whichever setting is in force.

import { ANNOTATION_LIMIT } from './annotate.js'
import type { AnnotationPlan, VerificationCounts, VerificationReportView } from './annotate.js'

export const FAIL_ON_VALUES = ['none', 'drift', 'any'] as const

export type FailOn = (typeof FAIL_ON_VALUES)[number]

/** Warning by default. A new checker must not break anyone's build on its first run. */
export const DEFAULT_FAIL_ON: FailOn = 'none'

export type NotCleanKind = 'errors' | 'unanchored' | 'low_coverage' | 'untriggered'

export interface NotCleanReason {
  kind: NotCleanKind
  count: number
  /** One line, written for the developer reading the check output. */
  summary: string
}

export interface Verdict {
  /** Claims whose cited value moved. The only drift signal. */
  drift: number
  /** Why this run cannot be called clean. Never folded into `drift`. */
  reasons: NotCleanReason[]
  failed: boolean
  /** The failure line, or null when the check passes. */
  failure: string | null
}

export function parseFailOn(raw: string): FailOn {
  const value = raw.trim().toLowerCase()
  if (!value) return DEFAULT_FAIL_ON
  if (!isFailOn(value)) {
    throw new Error(
      `Invalid value for fail-on: "${raw}". Expected one of: ${FAIL_ON_VALUES.join(', ')}.`,
    )
  }
  return value
}

function isFailOn(value: string): value is FailOn {
  return (FAIL_ON_VALUES as readonly string[]).includes(value)
}

export function decideVerdict(counts: VerificationCounts, failOn: FailOn): Verdict {
  const drift = counts.confirmedCount
  const reasons = notCleanReasons(counts)

  const failsOnDrift = drift > 0 && (failOn === 'drift' || failOn === 'any')
  const failsOnUnverifiable = reasons.length > 0 && failOn === 'any'
  const failed = failsOnDrift || failsOnUnverifiable

  return { drift, reasons, failed, failure: failed ? failureLine(drift, reasons) : null }
}

function notCleanReasons(counts: VerificationCounts): NotCleanReason[] {
  const reasons: NotCleanReason[] = []

  if (counts.errorCount > 0) {
    reasons.push({
      kind: 'errors',
      count: counts.errorCount,
      summary: `${plural(counts.errorCount, 'claim')} could not be read at all.`,
    })
  }
  if (counts.unanchoredCount > 0) {
    reasons.push({
      kind: 'unanchored',
      count: counts.unanchoredCount,
      summary: `${plural(counts.unanchoredCount, 'chapter')} declare no claims, so nothing about them can ever drift.`,
    })
  }
  if (counts.lowCoverageChapters.length > 0) {
    reasons.push({
      kind: 'low_coverage',
      count: counts.lowCoverageChapters.length,
      summary: `${plural(counts.lowCoverageChapters.length, 'chapter')} carry claims over too little of their own prose (${counts.lowCoverageChapters.join(', ')}).`,
    })
  }
  if (counts.untriggeredCount > 0) {
    reasons.push({
      kind: 'untriggered',
      count: counts.untriggeredCount,
      summary: `${plural(counts.untriggeredCount, 'claim')} sit in a repository no push and no sweep visits, so future drift in them is invisible.`,
    })
  }

  return reasons
}

function failureLine(drift: number, reasons: NotCleanReason[]): string {
  if (drift > 0 && reasons.length > 0) {
    return `Manual check failed: ${plural(drift, 'claim')} drifted, and this run could not vouch for the rest of the manual.`
  }
  if (drift > 0) {
    return `Manual check failed: ${plural(drift, 'claim')} no longer match the code they cite.`
  }
  return `Manual check failed: no drift was found, but this run could not vouch for the manual.`
}

/**
 * The job summary. Everything a developer needs that an inline annotation
 * cannot carry: findings with no line to attach to, and every reason the run is
 * not clean.
 *
 * Returns an empty string when there is nothing to report. A checker that
 * chatters on a clean run gets muted, and a muted checker is decorative.
 */
export function renderSummary(
  report: VerificationReportView,
  plan: AnnotationPlan,
  verdict: Verdict,
): string {
  if (verdict.drift === 0 && verdict.reasons.length === 0) return ''

  const lines: string[] = ['## DeployLog manual check', '']

  if (verdict.drift > 0) {
    const shown = Math.min(plan.annotations.length, ANNOTATION_LIMIT)
    const overflow = plan.annotations.slice(ANNOTATION_LIMIT)

    lines.push(
      `**Drift: ${plural(verdict.drift, 'claim')} no longer ${verdict.drift === 1 ? 'matches' : 'match'} the code.**`,
      '',
      overflow.length > 0
        ? `${shown} of ${plan.annotations.length} findings annotated inline on the changed lines; GitHub renders no more than ${ANNOTATION_LIMIT} per run.`
        : `${plural(shown, 'finding')} annotated inline on the changed lines.`,
      '',
    )

    // Everything past the limit, whole. These are the findings with no other
    // surface: they were placed correctly, on lines inside the diff, and GitHub
    // will simply not draw them. A run that bounds what it shows has to say what
    // it dropped, or the bound reads as coverage.
    if (overflow.length > 0) {
      lines.push(
        `### ${plural(overflow.length, 'finding')} not shown inline`,
        '',
        ...overflow.map(
          (annotation) =>
            `- \`${annotation.file}:${annotation.line}\`: ${annotation.message.split('\n').filter(Boolean).join(' ')}`,
        ),
        '',
      )
    }
  } else {
    lines.push('**No drift found.**', '')
  }

  if (plan.unreachable.length > 0) {
    lines.push(
      `### ${plural(plan.unreachable.length, 'finding')} with no line in this run`,
      '',
      ...plan.unreachable.map(
        (finding) =>
          `- ${unreachableLabel(finding.reason)}: "${finding.text}" (chapter ${finding.chapter}, ${finding.repository}/${finding.source}). ${finding.detail}`,
      ),
      '',
    )
  }

  if (verdict.reasons.length > 0) {
    lines.push(
      '### This run could not vouch for the manual',
      '',
      'Separate from drift, and not a clean bill of health:',
      '',
      ...verdict.reasons.map((reason) => `- ${reason.summary}`),
      '',
    )
  }

  // Each unreadable claim, whole: the sentence, the file, the server's reason
  // code and its detail. The reason line above carries the count and nothing
  // else, and a count is what a developer cannot act on (issue 60: every claim
  // failed `not_configured` and the output never said so).
  if (plan.errors.length > 0) {
    lines.push(
      `### ${plural(plan.errors.length, 'claim')} could not be read`,
      '',
      ...plan.errors.map(
        (error) =>
          `- \`${error.reason}\`: "${error.text}" (chapter ${error.chapter}, ${error.repository}/${error.source}). ${error.detail}`,
      ),
      '',
    )
  }

  lines.push(verdict.failed ? verdict.failure ?? '' : escalationNote(verdict))

  return lines.join('\n').trimEnd() + '\n'
}

function escalationNote(verdict: Verdict): string {
  const unescalated =
    verdict.drift > 0
      ? 'This check is green because escalation is off'
      : 'This check is green because no claim drifted'
  return `${unescalated}. Set \`fail-on: drift\` to fail on drift, or \`fail-on: any\` to fail on anything this run could not vouch for.`
}

function unreachableLabel(reason: 'no_line' | 'other_repository'): string {
  return reason === 'no_line'
    ? 'The cited value is gone, so there is no line to annotate'
    : 'Cited in another repository, which this run does not check out'
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
