# 45 — Manual check delivery: annotations, warning default, opt-in fail, loud bypass

**Status:** done 2026-08-23 (delivery core 08-15; the deferred observable arm was closed by issue 55, DONE 08-18 with criterion 1 observed on a live run) · **Type:** AFK · **Lane:** deploylog-action
**Parent:** ../deploylog/issues/prd-manual.md *(PRD lives in the deploylog repo)*
**Blocked by:** `../deploylog/issues/42` (done) — an out-of-repo dependency this repo's DAG cannot see.
**Verification:** PRD assertions 1 and 2, at the delivery surface. Failing tests to turn green in `src/annotate.test.ts` and `src/verdict.test.ts`, each guard with a control proving it can fire. Signal: `npm run typecheck && npm test`.

> Relocated here from `deploylog/issues/` on 2026-08-15, for the reason issue 27 was: every line of
> it edits this repo, and `afk-implement.sh deploylog` branches and commits the *deploylog* repo, so
> an AFK run against `Lane: deploylog` would have committed action-repo edits to the wrong branch or
> stranded them. Its number stays 45 because the PRD, the DAG and
> `deploylog/wiki/decisions/unverifiable-covers-thin-and-unwatched.md` all cite it by that number.

> **Rescoped 2026-08-15 after a plan-review pass.** As written this issue assumed the Action could
> "consume the service from issue 42". It cannot: `verifyChapters` is a library function in the
> deploylog repo, no HTTP endpoint exposes it, and the mirror tables that would let a server load an
> org's chapters do not exist (issue 49, not started). The issue also assumed a `changed_files` input
> that nothing in this Action produces — there is no `github-token` input and no `permissions` block.
> So this slice ships the delivery *decisions*, which are fully testable against fixture reports, and
> issue 55 ships the wiring when the endpoint exists. Splitting them keeps a client that would 404 in
> production, and a second hand-copy of the server contract, out of the repository.

> **Update 2026-08-15 (the note above is kept as written, because it records why this slice was
> split).** Issue 49 has since **shipped**, so "the mirror tables do not exist" is no longer true, and
> `deploylog/issues/56` — the endpoint this slice's sibling waits on — went from `blocked` to
> ready-for-agent on the same day. Nothing changes for *this* issue: it still owns the delivery
> decisions only, and the wiring is still issue 55. Read the parenthetical above as history.

## What to build

Drift reaches a developer as an annotation attached to the **changed source line** rather than to the
manual. Someone edits a constant and sees, on the line they just touched, that a manual sentence
states its old value. The warning arrives where and when fixing it is nearly free, which is the
entire reason for putting this in CI instead of a dashboard.

Three behaviours carry the design:

- **Warning by default.** A new checker must not break anyone's build on its first run.
- **Opt-in escalation.** An input escalates findings to a failed check, for teams that have come to
  trust it.
- **A silenced guard announces itself.** When escalation is off, findings still print prominently in
  the check output. A quiet opt-out is how this feature becomes decorative, and a safeguard a flag
  can silence must say so on every artifact the run produces.

## Acceptance criteria

- [x] A CONFIRMED finding produces an annotation on the changed source line, naming the manual
      sentence. (`planAnnotations`; the finding's `source` and `line`, message carries `text`.)
- [x] With escalation off, the check succeeds and the findings are still printed prominently.
      (`decideVerdict(counts, 'none')` never fails; `renderSummary` still prints the drift block.)
- [x] With escalation on, the same findings fail the check. (`fail-on: drift` and `fail-on: any`.)
- [x] A run with no findings produces no annotations and no noise — the control proving the
      annotation path can stay quiet. (`renderSummary` returns the empty string.)
- [x] A finding whose cited file is not in the diff does not attempt to annotate a line it cannot
      reach, and is reported through the run summary instead. (`unreachable`, both reasons:
      a disappearance with `line: null`, and a claim citing a sibling repository.)
- [ ] **Observable, deferred to issue 55:** both escalation states behave correctly on a real pull
      request, and the no-findings run is silent.

## Decisions taken here

**Exit status comes from the counts, never from `unverifiable`.** Per
`deploylog/wiki/decisions/unverifiable-covers-thin-and-unwatched.md`: drift is `confirmedCount`;
`errorCount`, `unanchoredCount`, `lowCoverageChapters` and `untriggeredCount` are each a reason the
run cannot be called clean. The flag is not in this repo's view type at all, which makes reading it
by accident impossible rather than merely discouraged.

**Escalation is `fail-on: none | drift | any`, default `none`, not a boolean.** A boolean leaves one
hole with no configuration that closes it: a run that could not read a single claim finds zero drift
and therefore exits green in *every* setting, so a team that gates on the check merges straight past
a checker that is simply broken. That is the PRD's named failure ("collapsing them is how a broken
checker reads as a clean one") relocated rather than avoided. The three settings select which signals
fail the check; they never merge them, and both are reported whichever setting is in force. One input,
so the issue's "an input escalates findings" still holds.

**The report view is narrow on purpose.** `VerificationReportView` carries only the fields the
delivery rules read. A second full copy of the server contract in this repo is what produced BUG-027,
where the Action sent a `null` version the server rejects because it did not track the schema.

## Known limitation, recorded rather than hidden

**An annotation can be correct and still not render.** CONFIRMED is scoped to claims whose *cited
file* is in the change, but `finding.line` is where the value sits at HEAD, which may fall outside the
pull request's diff hunks. GitHub only renders inline annotations for lines that are part of the
diff, and drops the rest silently. No fixture can catch this; it is a real-pull-request failure mode
and it belongs to issue 55's observable arm.

## Boundaries

- Do NOT implement the verification logic here; the service lives in the deploylog repo.
- Do NOT add an API client, a mode dispatch, `action.yml` inputs, or changed-files plumbing — that is
  issue 55, and it lands with the endpoint, not before.
- Do NOT add a dashboard surface for findings in this slice.
- Do NOT commit a `dist` build produced without a clean rebuild.
- **If the code you find doesn't match what this issue describes (drift since the Commit stamp above), STOP and report — do not improvise a fix.**
