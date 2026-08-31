# 59 — Marketplace copy for verify mode (draft for Marko)

**Status:** done 2026-08-24. Option A applied 08-18; Marko said "kill the dashes" 08-24: every em dash and arrow in `MARKETPLACE.md` + `README.md` rewritten (PR on `chore/59-kill-the-dashes`); CORRECTION 2026-08-24: there is no Long Description field for an Action listing (that is a GitHub App field); the live page renders `action.yml` description + `README.md`, fetched and confirmed after #15 merged, dash-free. Nothing to paste anywhere · **Type:** HUMAN · **Lane:** deploylog-action
**Blocks:** tagging the version that carries verify mode. `action.yml`'s description already
advertises it, and the two must not go live disagreeing.

Written to `references/voice.md`: short direct sentences, no hype, no em dashes or arrows. The
value gate is applied, so the opening names the reader's problem rather than the product's history.

## Short Description (max 80 characters)

Current, publish-only:

> Publish changelog entries from GitHub Releases. AI-polished release notes.

**Option A (75 chars). CHOSEN 2026-08-18, applied to `MARKETPLACE.md`.**

> Publish changelogs from Releases. Check your manual still matches the code.

**Option B (77 chars).** Names the mechanism, so the reader knows it is a check and not a viewer.

> Changelogs from your Releases. And a manual that fails CI when it goes stale.

**Option C (79 chars).** Keeps the AI line, which is the current listing's hook.

> Changelogs from Releases, AI-polished. Plus a manual checked against the code.

## Long Description, new section

To sit after the existing "Ship the update. Skip the busywork." paragraphs, before Features.

> ### Docs go stale quietly.
>
> A constant changes, the sentence describing it does not, and nobody finds out until a customer
> reads the old number. Nothing fails. Nothing is flagged. The doc just stops being true.
>
> Set `mode: verify` and this Action checks your DeployLog manual against the code it cites, on
> every pull request. When a cited value moves, the finding lands as an annotation on the changed
> line, next to the change that caused it.
>
> It starts quiet. On the default setting the check stays green and the findings are informational,
> so adding it to a busy repository breaks nothing on day one. When you trust it, `fail-on: drift`
> makes stale docs fail the build.

## Features, added bullets

> - Verify your manual against the code it cites, on every pull request
> - Findings appear inline on the changed line, not in a report nobody opens
> - Green by default, so it cannot break an existing build the day you add it

## Still open

1. **The existing Long Description uses em dashes** ("your product's website — automatically"). That
   predates the punctuation rule. Left alone rather than rewritten quietly. Say the word and it goes.
2. ~~Do not tag until the copy lands.~~ Settled: the copy landed 2026-08-18, so `MARKETPLACE.md`
   and `action.yml` now agree. The remaining tag blocker is elsewhere: whether verify mode should
   ship before its observable arm has ever run (issue 55, criterion 1).
