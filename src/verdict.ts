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
//
// And what the run vouched for, from deploylog issue 126 item 4. `confirmedCount`
// is drift, so "read it and it holds" and "could not read any of it" both report
// zero, and the green check said the same thing for both. `vouched` is the
// claims that held, derived exactly as the CLI derives it, and a run that
// vouched for nothing says so in the log and the job summary. It is reported,
// never escalated: it changes no exit status at any `fail-on` setting, so no
// consumer's build changes colour on upgrade.

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
  /**
   * Evaluated, vouched for, drifted and unreadable, in one line, so the derived
   * number sits beside the three it comes from and can be checked, not trusted.
   * Vouched for means read and found to hold: evaluated minus drifted minus
   * unreadable, because the wire has no count for it. Negative only when the
   * report contradicts itself, which `vouchedNothing` then says.
   */
  tally: string
  /** The headline when this run vouched for nothing, or null. Reported, never escalated. */
  vouchedNothing: string | null
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
  const evaluated = counts.evaluatedCount
  const vouched = evaluated - drift - counts.errorCount
  const nothing = vouchedNothingFor(counts, vouched)
  const reasons = notCleanReasons(counts)

  const failsOnDrift = drift > 0 && (failOn === 'drift' || failOn === 'any')
  const failsOnUnverifiable = reasons.length > 0 && failOn === 'any'
  const failed = failsOnDrift || failsOnUnverifiable

  return {
    drift,
    tally: `${plural(evaluated, 'claim')} evaluated, ${vouched} vouched for, ${drift} drifted, ${counts.errorCount} could not be read.`,
    vouchedNothing: nothing ? `This run vouched for nothing: ${nothing.why}.` : null,
    reasons,
    failed,
    failure: failed ? failureLine(drift, reasons, nothing) : null,
  }
}

interface VouchedNothing {
  /** Completes "This run vouched for nothing: ...". */
  why: string
  /**
   * The failure line when a run in this state fails with no drift, or null to
   * keep the general one. Only the cases where nothing could be READ (the CLI's
   * floor, issue 126 item 3) name it: a run that evaluated nothing fails only
   * on some other reason, and the line has to name the reason it failed on.
   */
  failure: string | null
}

/**
 * Why this run vouched for nothing, or null when it vouched for something.
 *
 * Deliberately NOT `vouched <= 0`. That is also true when every evaluated claim
 * DRIFTED, which is a fully informative run; the CLI shipped that spelling first
 * and narrowed it in review. Three cases, in this order: the counts contradict
 * each other (the wire schema does not cross-validate them, so a negative
 * `vouched` parses, and printing it as a finding would be a guess), nothing was
 * evaluated, or every evaluated claim was unreadable.
 */
function vouchedNothingFor(counts: VerificationCounts, vouched: number): VouchedNothing | null {
  if (vouched < 0) {
    const why = `the report's own counts do not add up (evaluated ${counts.evaluatedCount}, drifted ${counts.confirmedCount}, unreadable ${counts.errorCount})`
    return { why, failure: `Manual check failed: this run vouched for nothing, because ${why}.` }
  }
  if (counts.evaluatedCount === 0) return { why: 'it evaluated no claims', failure: null }
  if (counts.errorCount === counts.evaluatedCount) {
    const claims = plural(counts.evaluatedCount, 'claim')
    return {
      why: `not one of the ${claims} it evaluated could be read`,
      failure: `Manual check failed: this run vouched for none of the ${claims} it evaluated, because not one of them could be read.`,
    }
  }
  return null
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

function failureLine(
  drift: number,
  reasons: NotCleanReason[],
  nothing: VouchedNothing | null,
): string {
  // The floor's own headline, as the CLI prints it: a run that read nothing and
  // failed under `any` says what it vouched for, not just "could not vouch".
  if (drift === 0 && nothing?.failure) return nothing.failure
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
 * chatters on a clean run gets muted, and a muted checker is decorative. A run
 * that vouched for nothing is not a clean run, so it gets a summary: that green
 * is the one issue 126 found indistinguishable from a real pass.
 */
export function renderSummary(
  report: VerificationReportView,
  plan: AnnotationPlan,
  verdict: Verdict,
): string {
  if (verdict.drift === 0 && verdict.reasons.length === 0 && verdict.vouchedNothing === null) {
    return ''
  }

  const lines: string[] = ['## DeployLog manual check', '']

  if (verdict.vouchedNothing) lines.push(`**${verdict.vouchedNothing}**`, '')
  lines.push(verdict.tally, '')

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
  } else if (!verdict.vouchedNothing) {
    // Withheld from a run that vouched for nothing: "no drift found" over claims
    // nobody read is the false reassurance issue 126 quotes.
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
      : verdict.vouchedNothing
        ? 'This check is green, but not because anything was verified'
        : 'This check is green because no claim drifted'
  // No drift and no reason is reachable here only by a run that evaluated
  // nothing, and no setting fails that run. Naming one would promise a red
  // that never comes.
  if (verdict.drift === 0 && verdict.reasons.length === 0) return `${unescalated}.`
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
