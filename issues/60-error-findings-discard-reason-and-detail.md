# 60 — A failing verify run is undiagnosable from its own output

**Status:** done · **Type:** AFK · **Lane:** deploylog-action
**Found:** 2026-08-18, diagnosing the issue 55 observable arm.
**Verification:** point the Action at a project whose deployment has no `GITHUB_APP_ID`. The check
output must name `not_configured`. Today it does not.

## What happened

The first live verify run reported:

> Manual check: 0 drifted, 0 annotated inline. 1 reason this run could not vouch for the manual
> (see the job summary). The check is green because escalation is off.

The cause was that production had no GitHub App credentials, so every claim failed with
`not_configured`. Nothing in the check said so. Establishing it took, in order: a workflow edit to
print the six outputs, a local reproduction of `verifyChapters` against production data, and a
two-arm control with and without the credentials.

Every piece of information needed was already in the response.

## Why the output cannot say it

The wire carries it. `VerifyErrorFinding` has `reason` (one of nine) and `detail`, both populated:

```
reason: 'not_configured'
detail: 'Could not read src/lib/plan.ts at dd92d5c: GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set.'
```

Three separate places drop it.

1. `annotate.ts`'s `VerificationReportView` types `chapters[]` as `ChapterFindings`, which declares
   only `number`, `title`, `confirmed`. The `errors` array is not in the view at all, so the
   delivery layer cannot see it even in principle.
2. `verdict.ts`'s `renderSummary` prints `reason.summary` for each not-clean reason — for errors
   that is the string `"1 claim could not be read at all."`, which is the count and nothing else.
3. `verify.ts` emits no per-error output. `error-count` is a number with no accompanying text.

The narrowing in (1) is deliberate and correct for `unverifiable`; it is collateral damage for
`errors`.

## What to build

Surface error findings in the job summary, with their `reason` and `detail`, the way
`plan.unreachable` already surfaces findings that have no line. An error is not drift and must not
be counted as drift, but it is the thing a developer needs to read when the check reports nothing.

- Widen `ChapterFindings` to carry `errors`, or add a parallel accessor. Keep `unverifiable` out.
- `renderSummary` gains a section listing each error: the manual sentence, the file, the reason, the
  detail.
- Consider one `core.warning` per error finding, unanchored. A finding with no line still belongs in
  the log where a green check shows it.

## Acceptance criteria

- [x] A run whose claims all fail with `not_configured` names `not_configured` in its output.
- [x] The failing file and the manual sentence appear beside the reason.
- [x] Errors are still reported separately from drift; `drift-count` does not move.
- [x] A clean run stays silent. This must not become a checker that chatters.

## Boundary

`unverifiable` stays out of `VerificationReportView`. The reason that field is excluded is that exit
status must come from the counts, and widening the view for `errors` must not smuggle it back in.

## Resolution (2026-08-22)

PR #12 merged this write-up only. The fix: `ChapterFindings` carries `errors` (an `ErrorFinding`
with `reason` + `detail`; `unverifiable` stays out), `planAnnotations` collects them into
`plan.errors`, `renderSummary` adds a "claims could not be read" section listing reason, sentence,
file and detail, and `runVerify` logs one unanchored `core.warning` per error. `drift-count` and
`error-count` are untouched. Tests: 4 new arms (verify x3, verdict x1), all RED before the fix.

