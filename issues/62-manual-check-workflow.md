# 62 — The manual check runs on this repository's pull requests

**Status:** done (merged 2026-08-25; the Manual check ran green on its own pull request once the DEPLOYLOG_API_KEY secret existed; the first run failed on api-key, the known negative)
**Type:** AFK
**Lane:** deploylog-action
**Parent:** deploylog/issues/93-chapter-00-cross-refs-set-publish-v1.md
**Blocked by:** None — can start immediately
**Commit:** 05cda03
**Verification:** the `Manual check` workflow runs on this pull request and finishes; on a later pull request that changes `src/verdict.ts` or `action.yml`, the claims chapter 06 pins to them are evaluated (touched > 0) instead of counting as unmapped

## What to build
Chapter 06 of the DeployLog manual cites `action.yml`, `README.md`, `src/inputs.ts`, `src/release.ts` and `src/verdict.ts` in this repository (35 claims). A run of the Action's verify mode checks only the claims that cite the repository it runs in, so from the deploylog repo those 35 report `unmapped_repository`, and no push anywhere verifies them (`deploylog manual verify`, 2026-08-25). Add `.github/workflows/manual-check.yml`, the same file the deploylog repo runs (`deploylogdev/action@v1`, `mode: verify`, `project: deploylog`, `fail-on` left at its default `none`). The `DEPLOYLOG_API_KEY` secret is the one `main.yml` already uses.

## Acceptance criteria
- [x] `.github/workflows/manual-check.yml` on main, byte-identical to the deploylog repo's apart from the comment
- [x] The `Manual check` run on the pull request that adds it completes (zero claims evaluated on a pull request touching no cited file is the expected first result)
- [ ] The first later pull request touching `src/verdict.ts` shows the chapter 06 claims evaluated

## Boundaries
- Do NOT change `main.yml` or CI
- Do NOT add secrets by hand; report if one is missing
