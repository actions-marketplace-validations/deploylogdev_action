# 126 item 4: the Action says when a run vouched for nothing

**Status:** in review as PR #21 (opened 2026-10-10 from branch `feat/126-vouched-summary`, ready,
not draft). Merging is Marko's, after CI.
**Type:** AFK
**Lane:** deploylog-action
**Parent:** item 4 of `deploylog/issues/126-manual-verification-confirms-nothing.md`, read with its
2026-09-18 amendment (`confirmed` is drift; `vouched` is evaluated minus drifted minus unreadable).
That ticket's own Status line is updated from the deploylog side, not from this repository.
**Lands after:** `issues/node24-runtime.md` (PR #20, merged as 4eef56c), so one v1.2.3 release and
one `v1` move cover both.
**Blocked by:** None
**Commits:** fb1bed5 (src, tests, dist), af2ff8e (README), plus this file
**Verification:** `npm run typecheck`, `npm test`, then delete `dist/`, `npm run build`, and
`git status --porcelain dist/` prints nothing. The new copy is pinned by unit tests in
`src/verdict.test.ts` and `src/verify.test.ts`.

## The problem

Item 4 of deploylog issue 126: "Whatever the Action's `manual` check does with the exit code, make
it surface the same distinction, or the PR badge keeps saying what it says today."

`confirmedCount` is drift, so a run that read every claim and found them all holding and a run that
read none of them both reported `drift-count` 0 (measured: `decideVerdict` read only
`confirmedCount` and the four not-clean counts). Two runs showed it, both reproduced as RED tests
before the change (measured):

- A scoped pull request that touched no cited file evaluates no claims. The run logged
  `Manual check: no drift, and nothing this run could not vouch for.` and wrote no job summary,
  which is word for word what a run that read every claim and found them holding logs.
- A run that could read none of the claims it evaluated wrote `**No drift found.**` and
  `This check is green because no claim drifted`, the false reassurance issue 126 quotes from
  production.

## What changed

- `src/verdict.ts`. `decideVerdict` adds two fields to the verdict. `tally` is one line with all
  four claim counts: `459 claims evaluated, 336 vouched for, 2 drifted, 121 could not be read.`
  Vouched for is evaluated minus drifted minus unreadable, derived exactly as the CLI derives it
  (`deploylog-cli` `src/manual-verify.ts`, `vouchedFor`). `vouchedNothing` is
  `This run vouched for nothing: <why>.` in three cases, in this order: the counts contradict each
  other (vouched below 0), the run evaluated no claims, or every evaluated claim was unreadable.
  It is deliberately not "vouched is 0": a run whose evaluated claims all drifted vouched for 0 and
  is a fully informative run, which is the narrowing the CLI made in its own review pass.
- The job summary is written for a run that vouched for nothing, headed by that line in bold, with
  the tally under it. `**No drift found.**` is withheld from such a run, and its closing note reads
  `This check is green, but not because anything was verified.` Every summary carries the tally.
- Under `fail-on: any`, a run that read nothing fails on
  `Manual check failed: this run vouched for none of the N claims it evaluated, because not one of them could be read.`,
  the CLI's line, instead of the generic one.
- `src/verify.ts` logs `Manual check: <tally>` on every run that got a report, and the
  vouched-for-nothing line when it applies, both as `info`. The transport-failure path still logs
  no counts.
- `src/annotate.ts`. `VerificationCounts` gains `evaluatedCount`, which the wire type in `api.ts`
  already carried.
- `README.md`. One paragraph under `fail-on`.
- `dist/index.js` rebuilt clean.

No exit status changes at any `fail-on` setting, and `DEFAULT_FAIL_ON` stays `none`.

## RED then GREEN

RED, the tests written first against unchanged `src/` (measured 2026-10-10):
`Test Files 2 failed | 7 passed (9)`, `Tests 17 failed | 109 passed (126)`. Every failure was an
assertion on the missing behaviour, none a crash. The two that carry the defect:

- `expected '' to contain '**This run vouched for nothing: it ev…'` (the evaluated-zero run wrote
  no summary)
- `expected 'Manual check: no drift, and nothing t…' to contain 'This run vouched for nothing: it eval…'`
  (the evaluated-zero run logged the clean-run line)

Three arms passed on RED by design. They pin what must NOT change: no exit status moves at any
setting, an evaluated-zero run stays green at all three settings, and it adds no annotation. Each
was then shown able to fail by the mutation table below.

GREEN: `Test Files 9 passed (9)`, `Tests 126 passed (126)` (measured). Baseline before any edit was
107 passed (measured).

## Gates

Measured 2026-10-10 on Windows 11, Node v24.19.0, each command on its own line, after the
self-review fix below:

| Gate | Result |
|------|--------|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0, 126 passed in 9 files |
| `rm -rf dist`, `npm run build` | exit 0 |
| `npm run package` | exit 0, 126 passed |
| A second clean build | `cmp` identical to the first |
| `dist/index.js` diff | only this change; no `__toESM` helper drift |
| Dash and arrow codepoints in added lines | 0 (the scan returned 1 on a planted em dash) |
| CRLF in every changed file | 0 |

Mutation arms, one per new behaviour, each run against the final code and then restored. The
sha256 of both files matched before and after:

| Mutation | Caught by |
|----------|-----------|
| M1 read-none predicate spelled `vouched === 0`, the CLI's retired spelling | CONTROL: every evaluated claim drifted |
| M2 summary early return ignores vouched-for-nothing | the evaluated-zero summary arm, in both suites |
| M3 console clean branch ignores vouched-for-nothing | the evaluated-zero log arm |
| M4 the closing note always names a `fail-on` setting | the evaluated-zero summary arm |
| M5 failure line ignores the read-none headline | three failure-line arms |
| M6 the vouched-for-nothing line logged as a warning | the no-annotation arm |
| M7 contradiction branch removed | the contradiction arm |
| M8 vouched-for-nothing escalated under `fail-on: any` | both no-exit-change pins |

8 of 8 caught, each by vitest exit 1 plus its own FAIL line (measured).

## Self-review

- Standards. The lane `CLAUDE.md`: strict TypeScript, vitest, a test that fails without the change,
  `dist/` rebuilt clean and committed with the `src/` it comes from. No new dependency, no skipped
  test, no stray file (measured: `git status --porcelain` lists only the intended files).
- Spec. Found and fixed one defect: the first version also put `evaluated` and `vouched` number
  fields on the verdict, and only tests read them, because `tally` already carries both numbers.
  Removed; the tests assert the tally instead. Every new field now has a non-test reader:
  `tally` and `vouchedNothing` are read by `renderSummary` and `runVerify`.

| Acceptance (the default stated for this item) | Result |
|-----------------------------------------------|--------|
| Print the evaluated and vouched counts | met, every run that got a report (log), every summary written |
| A clear "vouched for nothing" line in the check output when a run evaluated zero claims | met, log and job summary |
| The same when a run could not vouch | met for "could read none of what it evaluated" and for contradicting counts |
| `DEFAULT_FAIL_ON` stays `none` | met, the existing `parseFailOn` test asserts it |
| No consumer build starts failing | met at unit level, pinned at all three settings; not runnable against a live consumer |
| Clean dist rebuild | met |

## Defaults taken (not yet confirmed)

Dated 2026-10-10. Each is reversible and none blocks the merge.

1. The vouched-for-nothing line is a report, never a failure. The CLI's floor fails a run that
   read nothing at its default `drift`; the Action does not mirror that at `fail-on: drift`,
   because it would turn red a consumer build that is green today. See Marko decisions.
2. "Vouched for nothing" covers three runs: evaluated none, every evaluated claim unreadable, and
   counts that contradict each other. A run where every evaluated claim drifted is not one of them.
3. A run that evaluated no claims now writes a job summary. On a manual that cites one repository,
   that is every pull request touching no cited file (inferred), so the Summary tab of those runs
   carries a short summary where it was empty before. One condition in `renderSummary` reverses it.
4. Both new console lines are `info`, not `warning`. A warning becomes an annotation and spends
   GitHub's per-step budget, which the drift findings use. So the pull request's checks panel shows
   no new annotation; the line is in the step log and the job summary.
5. The tally is logged on every run that gets a report, a clean run included (one line). It is
   never logged when the run could not reach DeployLog.
6. No new outputs (`evaluated-count`, `vouched-count`). Nothing in this repository would read them.
7. Under `fail-on: any`, a run that read nothing (or whose counts contradict) fails on the
   vouched-for-nothing line, as the CLI does. A run that evaluated nothing and fails under `any`
   for another reason, such as untriggered claims, keeps the general failure line, because that
   line has to name what it failed on.
8. The closing note on an evaluated-zero run with no other reason names no `fail-on` setting,
   since no setting fails that run.
9. A negative vouched count (contradicting counts) is printed as it is, with the explanation line
   above it, rather than clamped to 0.
10. `docs/manual/06-github.md` is not edited. It is written by DeployLog's own chapter pull requests
    (inferred from its history: bfe148d and f56fb59, "docs(manual): update chapter 06, GitHub").
    This change drifts one of its claims, and the code is not bent to keep the old anchor matching;
    see "The manual drift this change causes" below.
11. This file is named for its deploylog issue number, like the issue docs pruned in 0f11673.

## Marko decisions

- **Merge (Marko-only, after CI).** Base is `main` at 4eef56c, which already carries the node24
  runtime.
- **Release v1.2.3 and move `v1` (Marko-only).** One release now covers both the node24 runtime
  (#20) and this change. Bump `package.json` `version` to `1.2.3`, tag, `gh release create v1.2.3`,
  then move the `v1` major tag to the same sha, or consumers never get either change. Per this
  repo's `CLAUDE.md`, re-tagging an existing release needs `gh release delete --cleanup-tag` first.
  The open question about `.github/workflows/main.yml` in `issues/node24-runtime.md` still applies
  to that release run.
- **Should `fail-on: drift` fail a run that read nothing, as the CLI's default now does?** Not done
  here (default 1). Yes means a consumer on `drift` with a broken checker goes red on upgrade.
- **Outputs.** Add `evaluated-count` and `vouched-count` if a consumer asks to gate on them.
- **Update chapter 06 after the release.** Its claim on the empty summary drifts with this change;
  details in the next section.

## The manual drift this change causes

The pull request's `Manual check` run logged `Manual check: 1 drifted, 0 annotated inline.`
(measured: run 38039314103 on 7aa3786). A read-only `deploylog manual verify --project deploylog
--changed-from origin/main --fail-on none` at the same sha names it (measured):

    06 GitHub  CONFIRMED  confirmed 1 / errors 0 / untriggered 0 / touched 2
      drift  src/verdict.ts  "On a clean run the summary is empty and nothing is written."  "if (verdict.drift === 0 && verdict.reasons.length === 0) return ''" no longer appears in src/verdict.ts.
    Summary: confirmed 1 / errors 0 / unanchored 0 / evaluated 20 / skipped 436 / vouched 19

This is a true finding, not noise. The claim's anchor is the old early return, and by that
anchor's own condition a run that evaluated nothing counted as clean; it now writes a summary.
Nesting the old line under a new guard would keep the anchor matching while the behaviour it
describes changed, which is the false clean the check exists to catch, so the code is left as it
should read. After the release, chapter 06 needs its sentence re-anchored to the new condition,
and probably a sentence saying that a run which vouched for nothing gets a summary (Marko step:
regenerate or edit chapter 06 in DeployLog, which then opens its own chapter pull request here).
The check stays green meanwhile (`fail-on: none`).

## Not verified

1. ~~CI on Linux, including the dist check.~~ Now measured: CI run 38039314205 on 7aa3786, the
   `test` job (Node 24, typecheck, tests, dist check) passed.
2. How the job summary renders on github.com. The markdown is pinned by unit-test strings and was
   read from a scratch render of every case (measured); no live run shows it yet.
3. The pull request's own `Manual check` run does not exercise this code. `manual-check.yml` pins
   `deploylogdev/action@v1`, the released v1.2.2 (measured: the workflow file pins `@v1`, and
   `git ls-remote` shows `v1` and `v1.2.2` on the same sha, b95e750). Its log line above is in the
   old format, with no tally (measured), so the new lines appear on this repository's checks only
   after the release and the `v1` move (inferred).

## Pull request

The body is this file with the attribution line appended.
