# 61 — GitHub renders only 10 annotations per level per step, and the rest vanish

**Status:** DONE 2026-08-18 · **Type:** AFK · **Lane:** deploylog-action
**Parent:** issue 55, "Carried forward from issue 45" — the risk it recorded and could not measure.
**Verification:** a report carrying more findings than the limit renders the limit and lists every
remaining finding in the job summary. No finding disappears.

## The defect

`runVerify` calls `core.warning` once per annotation, with no bound. GitHub renders at most **10
annotations per level per step** and drops the rest without an error, a warning, or any entry in the
log.

So a pull request touching a file with 15 drifted claims shows 10 inline, silently loses 5, and the
job summary says `15 findings annotated inline on the changed lines` — a sentence that is false about
this run and cannot be checked by anyone reading it.

Issue 55's observable arm produced exactly one annotation, so the cap was never approached and this
stayed a prediction rather than a measurement.

## Why it is worse than the out-of-hunk case

Issue 45 carried forward that an annotation can be correct and still not render, because its line
falls outside the diff. `planAnnotations` handles that honestly: a finding it cannot place goes to
`unreachable` and is listed in the summary.

The cap has no such path. The findings are placed, correct, in the diff, and counted as delivered.
The only thing wrong is that nobody sees them, and the run reports that they were seen.

## What to build

- A shared limit constant, read by the one place that emits and the one place that reports. Two
  copies of the number is how they drift apart.
- Emit at most the limit.
- The summary reports what was shown against what was found (`10 of 15`), and lists every finding
  beyond the limit the way `unreachable` findings are already listed. A run that bounds what it
  shows must say what it dropped.

## Acceptance criteria

- [x] A report with more findings than the limit emits exactly the limit.
- [x] Every finding past the limit appears in the job summary, with its file, line and detail.
- [x] The summary's count line distinguishes shown from found: `10 of 15 findings annotated inline`.
- [x] A report at or under the limit is unchanged: `10 findings annotated inline`, no overflow
      section. Its own arm, and the known negative for the bound.
- [x] A clean run is still silent.

## Boundary

The limit is GitHub's, not a preference. If GitHub changes it, one constant moves.

## Run record — 2026-08-18

`ANNOTATION_LIMIT` lives in `annotate.ts` and is read by the emitter and by the reporter. Two copies
of the number is how the annotation you see and the sentence describing it come to disagree.

`planAnnotations` was deliberately left uncapped. It plans every finding it can place; the bound is
delivery. Capping at plan time would drop findings before anything could report them, which is the
defect rather than the fix.

The emitter takes the FIRST `ANNOTATION_LIMIT` and the summary lists
`annotations.slice(ANNOTATION_LIMIT)`. That agreement is asserted, not assumed: an emitter taking a
different subset would leave both halves individually true and the pair a lie.

**The calibration caught a real hole in this slice's own tests.** The first pass had four summary
arms, all green, and reverting the emitter to unbounded left them all green — the bound that is the
entire point of the issue had no test, and the summary arms were carrying it. Four emit arms were
added and the mutants re-run:

| Mutant | Before | After |
|---|---|---|
| Emit unbounded | **survived** | 2 arms red |
| Emit the last N instead of the first | not tested | 1 arm red |
| Emit nothing | not tested | 5 arms red |
| Drop the overflow listing | 1 arm red | 1 arm red |

Note what stays untestable by design: raising `ANNOTATION_LIMIT` to 1000 leaves every arm green,
because the arms are written against the constant rather than against the number 10. That is
correct — the limit is GitHub's, and if GitHub changes it one constant moves — but it means no test
defends the value itself. It is documented at the constant instead.

100 tests, typecheck clean, `dist` rebuilt from that run.
