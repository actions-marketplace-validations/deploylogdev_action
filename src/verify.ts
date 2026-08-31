// The verify run: fetch a report, deliver it, decide the exit status.
//
// Everything this module decides is already decided elsewhere. `planAnnotations`
// owns which findings can be shown inline, `decideVerdict` owns what fails the
// check, and `renderSummary` owns what a developer reads. This is the wiring, and
// it stays thin on purpose — a delivery rule that grows here is a rule with no
// test of its own, because the tests for those rules live beside them.
//
// The one judgment that belongs here is the annotation level. GitHub renders
// `error` as a red squiggle, and a red squiggle beside a green check reads as a
// broken checker, so findings are warnings until the check actually fails.
//
// A transport failure fails the run at every `fail-on` setting, including `none`.
// `none` means "no finding fails this check", never "this check cannot fail" — a
// checker that could not reach DeployLog has not vouched for anything, and
// reporting green for it is the false-clean this whole module is arranged
// against. The README says so in the same words.

import type { ActionInputs } from './inputs.js'
import type { ApiClientConfig } from './api.js'
import { createApiClient } from './api.js'
import type { ActionLogger } from './run.js'
import type { VerifyContext } from './verify-context.js'
import type { VerificationReportView } from './annotate.js'
import { ANNOTATION_LIMIT, planAnnotations } from './annotate.js'
import { decideVerdict, renderSummary } from './verdict.js'

export interface VerifyRunOptions {
  inputs: ActionInputs
  context: VerifyContext
  logger: ActionLogger
  clientFactory?: (config: ApiClientConfig) => ReturnType<typeof createApiClient>
}

export async function runVerify(opts: VerifyRunOptions): Promise<void> {
  const { inputs, context, logger } = opts
  const factory = opts.clientFactory ?? createApiClient
  const client = factory({ baseUrl: inputs.apiUrl, apiKey: inputs.apiKey })

  const report = await client
    .verifyManual({
      project: inputs.project,
      repository: context.repository,
      ref: context.ref,
      changedFiles: context.changedFiles,
    })
    .catch((err: unknown) => err instanceof Error ? err : new Error(String(err)))

  if (report instanceof Error) {
    // The one output that is knowable without a report. The counts stay unset
    // rather than being written as zeroes, because a zero here would be a claim
    // about the manual and this run has none.
    logger.setOutput('check-failed', 'true')
    logger.setFailed(`Could not verify the manual: ${report.message}`)
    return
  }

  // Narrowed the moment it arrives. `unverifiable` exists on the wire type and
  // `annotate.ts` keeps it off this one deliberately: exit status comes from the
  // counts, and a field you cannot name is one you cannot read by accident.
  const view: VerificationReportView = report
  const plan = planAnnotations(view, { repository: context.repository })
  const verdict = decideVerdict(view, inputs.failOn)

  // `verdict.failed` alone decides this. The extra `drift > 0` clause that used
  // to be here read as a safeguard and was inert: annotations are built only
  // from confirmed findings and `drift` IS the confirmed count, so there is no
  // state with annotations and no drift for it to distinguish. A mutation test
  // removing it left every test green, which is what a guard with no reachable
  // case looks like.
  const level = verdict.failed ? 'error' : 'warning'
  // Bounded on purpose. GitHub renders the first ANNOTATION_LIMIT and discards
  // the rest in silence, so emitting more does not deliver more; it only makes
  // the run believe it did. Everything past the bound is listed in the summary.
  for (const annotation of plan.annotations.slice(0, ANNOTATION_LIMIT)) {
    logger.annotate(annotation, level)
  }

  // Unanchored on purpose: an error has no line, and a finding with no line
  // still belongs in the log where a green check shows it. The full text is in
  // the summary; this line carries what a developer searches for first.
  for (const error of plan.errors) {
    logger.warning(
      `Manual claim could not be read (${error.reason}): "${error.text}" cites ${error.repository}/${error.source}. ${error.detail}`,
    )
  }

  logger.setOutput('drift-count', String(verdict.drift))
  logger.setOutput('error-count', String(view.errorCount))
  logger.setOutput('unanchored-count', String(view.unanchoredCount))
  logger.setOutput('untriggered-count', String(view.untriggeredCount))
  logger.setOutput('low-coverage-chapters', view.lowCoverageChapters.join(','))
  logger.setOutput('check-failed', String(verdict.failed))

  const summary = renderSummary(view, plan, verdict)
  if (summary) await logger.summary(summary)

  if (verdict.failed) {
    logger.setFailed(verdict.failure ?? 'Manual check failed.')
    return
  }

  if (verdict.drift === 0 && verdict.reasons.length === 0) {
    logger.info('Manual check: no drift, and nothing this run could not vouch for.')
    return
  }

  // Both halves in the one line a green check shows first. Reporting the drift
  // count alone would merge "nothing drifted" with "nothing could be read",
  // which is the distinction the counts are kept separate to preserve.
  const notClean = verdict.reasons.length
    ? ` ${verdict.reasons.length} reason${verdict.reasons.length === 1 ? '' : 's'} this run could not vouch for the manual (see the job summary).`
    : ''
  logger.info(
    `Manual check: ${verdict.drift} drifted, ${plan.annotations.length} annotated inline.${notClean}` +
      ' The check is green because escalation is off.',
  )
}
