# 55 — Manual verify mode: transport, changed files, and the real pull-request arm

**Status:** DONE 2026-08-18. All six criteria met, criterion 1 observed on a live run.
**Parent:** ../deploylog/issues/prd-manual.md *(PRD lives in the deploylog repo)*
**Blocked by:** ~~`../deploylog/issues/56`~~ — cleared 2026-08-18. deploylog PRs #54 and #55 merged;
`src/app/api/cli/manual/verify/route.ts` is live on `main` (`9bedc81`), confirmed against
`git ls-remote`, not a local tracking ref.
**Verification:** PRD assertions 1 and 2, observable. A scratch pull request that changes a cited constant shows the annotation inline; with escalation off the check is green and the finding is still visible.

The half of issue 45 that could not be built when 45 was built. 45 shipped the delivery decisions as
pure functions over a fixture report (`src/annotate.ts`, `src/verdict.ts`, both tested). This wires
them to a real run.

## What to build

- **An API client method** for the verify endpoint issue 56 defines, following the existing
  `src/api.ts` shape. Mirror the endpoint's response schema, not the internal service type.
- **Changed-files acquisition.** The Action has no source for this today. Either a `github-token`
  input plus `permissions: pull-requests: read` and the pull-request files API, or a checkout depth
  the workflow guarantees plus a git diff. Pick one and document the workflow snippet it requires.
- **Mode dispatch.** An explicit `mode: publish | verify` input, defaulting to `publish`. Do not
  infer from `github.context.eventName`: a workflow triggered on both `release` and `push` would
  start running verify on pushes nobody opted into. `src/main.ts` reads only
  `github.context.payload.release` today, so the entry point needs a real refactor.
- **`action.yml` inputs and outputs**: `mode`, `fail-on` (`none` | `drift` | `any`, default `none`,
  parsed by the existing `parseFailOn`), whatever identifies the manual, and outputs for the counts.
- **The edge**: `core.warning(message, { file, startLine, title })` per annotation — `warning`, not
  `error`, when escalation is off, because red squiggles on a green check read as broken —
  `core.summary` for `renderSummary`, and `core.setFailed` on `verdict.failure`.

## Acceptance criteria

- [x] A scratch pull request changing a cited constant shows the annotation inline on the changed line.
      Observed 2026-08-18 on marko-builds/deploylog PR #57. See the run record below.
- [x] With `fail-on: none` the check is green and the finding is still visible in the output.
      Observed: check conclusion `success`, one warning-level annotation carrying the manual
      sentence and the detail.
- [x] With `fail-on: drift` the same finding fails the check. (`verify.test.ts`)
- [x] With `fail-on: any` a run with errors and no drift fails the check. (`verify.test.ts`)
- [x] A run with no findings is silent: no annotations, no job summary. (`verify.test.ts`)
- [x] An existing `release`-triggered workflow is unaffected by the upgrade. (`run.test.ts`,
      `inputs.test.ts` — the default mode is `publish` and a release payload present in verify mode
      is ignored rather than double-handled.)

## Run record — 2026-08-18

Built: `verifyManual` in `src/api.ts` over a mirror of `ManualVerifyRequestSchema` /
`ManualVerifyResponseSchema`; `src/verify-context.ts` (ref and changed-file resolution);
`src/verify.ts` (the run); mode dispatch in `src/run.ts`; the `core.*` edge in `src/main.ts`;
`action.yml` inputs and outputs; a README section with the workflow snippet. 76 tests pass,
`npm run package` clean, `dist/index.js` rebuilt from that run.

**Changed files come from the pull-request files API**, not a git diff, so the workflow needs no
`actions/checkout` and no `fetch-depth`. It needs `permissions: pull-requests: read` and
`github-token: ${{ github.token }}`. Without the token the run verifies the whole manual and says
so; that is the same fallback used when the event is not a pull request, and when the file list hits
GitHub's 3000-file listing cap. An incomplete file list under-scopes claims and reports a clean
manual over real drift, so every path that cannot produce a trustworthy list resolves to `null`
(full sweep) rather than to a partial one.

**The ref is `pull_request.head.sha`, never `context.sha`.** On a pull request `context.sha` is the
synthesised merge commit; the server re-pins this repository to whatever ref it is sent and reports
`finding.line` at that ref, and GitHub drops annotations for lines outside the diff hunks, which are
computed at the head. `resolveVerifyContext` throws rather than sending anything that is not a
40-character sha.

**The fourth criterion was constructed so it can only fail for the reason it names.** Against a real
multi-repository manual, `fail-on: any` fails on `untriggeredCount` alone
(`../deploylog/wiki/decisions/verify-runs-at-the-run-ref.md` §3), so an arm built on a live report
would pass whether or not the error path works. The arm pins every other not-clean signal to zero and
asserts it, its known negative (the same report under `fail-on: drift`) is green, and a sibling arm
proves an untriggered-only failure is attributed to untriggered and not to errors.

**Also corrected:** `src/annotate.ts`'s source-of-truth comment named
`src/lib/manual-verification.ts`. The wire contract is `ManualVerifyResponseSchema` in
`src/lib/schemas.ts`; the route validates against it on the way out precisely so the service type may
differ, which makes the service type the wrong thing to mirror. `VerificationReportView` itself was
checked field-by-field and needed no change.

**Not verified, and it is the whole observable arm:** nothing here has run against the live endpoint.
Criterion 1 needs a scratch pull request on a repository with a DeployLog project, a manual, a
connected repository, and `DEPLOYLOG_API_KEY` in secrets. Target: `marko-builds/deploylog`.

## Review pass — 2026-08-18

`/review-diff` over `328072f`, two axes. Fixed in the follow-up commit:

- **An empty changed-file list was trusted**, so the server evaluated no claim and the run was
  byte-identical to a verified-clean manual. `collectChangedPaths` now returns a discriminated
  `untrusted` result for both the cap and the empty case, each with its own warning.
- **A pull-request payload with no head sha silently sent the merge commit** — the one ref this
  slice exists to avoid, and the fallback was invisible. `toWorkflowRun` throws instead, and the
  narrowing moved out of `main.ts` into a tested function.
- **The `drift > 0` half of the annotation level was inert**, not merely untested: annotations are
  built only from confirmed findings and `drift` IS that count, so no state could distinguish it. A
  mutation removing it left every test green. Deleted, with its comment.
- **`unverifiable` had become readable inside `runVerify`** through the wide wire type, defeating the
  safeguard `annotate.ts:18-22` describes. The report is narrowed to `VerificationReportView` on
  arrival, so the field is unnameable again.
- **`check-failed` was unset on the transport-failure path**, inverting a downstream
  `!= 'false'` guard. Now set; the counts stay unset deliberately, since a zero would be a claim
  about a manual this run never received.
- **The job-summary write was unguarded** — a runner without `GITHUB_STEP_SUMMARY` turned a green run
  red. Caught and downgraded to a warning.
- **Secret masking sat behind two throwable statements.** Both secrets are masked immediately after
  reading now, calibrated against two mutants: removing the mask and moving it back after validation
  each turn the new test red.
- **The typecheck gate could not see test files** (`tsconfig.json` excluded them), so the two
  required-field additions this slice made were outside its scope. Exclusion removed; calibrated by
  planting a logger missing `annotate`, which the widened gate catches and `vitest` alone does not.
- A comment claiming a `skip-prerelease` env leak: **no test ever set it**. The rationale was
  invented; corrected to what is actually true.

**Decided:** `fail-on: none` keeps failing on transport errors, and the README was the wrong half.
`none` selects which *findings* fail the check; it never means the check cannot fail. A run that
could not reach DeployLog has vouched for nothing, and green would be the false clean this slice is
arranged against.

**Recorded, not fixed — this threatens criterion 1 more than the out-of-hunk risk below.** GitHub
renders at most **10 annotations per level per step**. A pull request with 15 drifted claims emits
15 `core.warning` calls, shows 10, and drops 5 with no error; the summary would say "15 findings
annotated inline" while listing none of them, because `renderSummary` deliberately excludes
annotated findings. Measure the real cap on the scratch run before deciding. The fix, if needed,
lands in `verdict.ts` — which this issue's Boundaries fence off, so it is issue 45 territory and
needs its own slice.

## Observable arm: deferred, and why

Criterion 1 cannot run today, and the blocker is not in this repo. The Manual feature's **entire
schema is unapplied in production**: `20260815000000_connected_repositories`,
`20260815010000_manual_mirror_tables` and `20260815020000_manual_chapter_approval` have never been
run against the live database. There is no `connected_repositories` table to connect a repository
in, and no `manual_versions` for a working version to live in, so `getWorkingVersion` cannot
succeed. The endpoint answers 401 rather than 404 only because Next.js routes it.

Decided 2026-08-18: **the arm waits for the Manual feature's own launch** rather than applying an
unlaunched feature's schema to production to unblock a test. Nothing about the arm expires. When
the schema ships, the setup is: an API key with `read`, connect `marko-builds/deploylog`
(installation id **153878377**), a manual chapter citing `src/lib/plan.ts`'s `FREE_PROJECT_LIMIT`,
then a scratch pull request changing that constant.

## Observable arm: RUN AND PASSED, 2026-08-18

`marko-builds/deploylog` PR #57, `deploylogdev/action@v1` at v1.2.1. The annotation GitHub rendered,
verbatim from the check-runs API:

```
src/lib/plan.ts:15  [warning]  Manual drift in chapter 01
    This line no longer matches what the manual says about it.
    Manual sentence: "The free plan allows 3 projects."
    FREE_PROJECT_LIMIT is 4, the manual says 3.
    Chapter 01 " Plan limits", claim free-project-limit.
```

Counts: `drift-count=1 error-count=0 unanchored-count=0 untriggered-count=0 check-failed=false`.

**The out-of-hunk risk carried forward from issue 45 did not bite, and the reason is the ref
choice.** The run logged `head sha = dd92d5c` against `context sha = 604047f` — genuinely different
commits. `finding.line` is computed at whatever ref the request names, so had the Action sent
`context.sha` the finding would have been computed at a merge commit that exists in no branch, and
GitHub would have dropped the annotation without reporting anything. `verify-context.ts`'s headline
rule is load-bearing and is now demonstrated, not argued.

**Changed-file scoping worked**: `Verifying claims that cite any of the 2 files this pull request
changes`, and the claim citing `src/lib/plan.ts` was evaluated while nothing else was.

### Still unmeasured: the 10-annotation cap

This run produced ONE annotation, so the cap was never approached. The risk recorded above stands
untested. Measuring it needs a chapter with more than ten claims over one file, which is a separate
exercise.

### Three defects the arm exposed, none of them in this slice

1. **v1.2.0 could not load at all.** `${{ }}` in an `action.yml` input *description*; Actions
   evaluates expressions in manifest metadata. Fixed in v1.2.1 with `action-manifest.test.ts`.
   Nothing in the repo had ever read `action.yml`, which is why a full green suite shipped it.
2. **The Action discards `reason` and `detail` from error findings.** Diagnosing why the run
   reported nothing took a workflow edit to print the outputs, then a local reproduction, then a
   two-arm control. `renderSummary` prints "1 claim could not be read at all" and drops the
   `not_configured` that would have named the cause in one glance.
3. **A deployment with no GitHub App credentials reports a green check.** Every claim errors with
   `not_configured` and the run is `unverifiable` with zero drift. A server that cannot read any
   file has not verified anything and should say so with a 503, not a per-claim error finding.

### What the setup actually required, for whoever repeats it

Three migrations applied to production, `MANUAL_ENABLED=true`, `GITHUB_APP_ID` and
`GITHUB_APP_PRIVATE_KEY` on Vercel (all three env vars needing their own redeploy), a
`connected_repositories` row inserted by hand (no UI exists), and the claim inserted by hand
(`generateChapter` has no production caller). Two of those were discovered only by the run failing.

## Carried forward from issue 45

**An annotation can be correct and still not render.** `finding.line` is where the value sits at
HEAD, which may fall outside the pull request's diff hunks, and GitHub silently drops annotations for
lines not in the diff. This is the arm that discovers it. Measure it on the scratch pull request
before calling the delivery surface done, and if it bites, the fix is a decision about what to do
with an out-of-hunk finding (summary-only, or nearest-hunk), not a bug in `planAnnotations`.

## Boundaries

- Do NOT rewrite `src/annotate.ts` or `src/verdict.ts` to reach these criteria; they are tested and
  their controls are the calibration. If a delivery rule is wrong, change it deliberately and move
  its control with it.
- Do NOT commit a `dist` build produced without a clean rebuild.
