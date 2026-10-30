# node24 runtime: the Action declares, bundles for and is tested on Node 24

**Status:** in review. Built on branch `chore/node24-runtime`; merging it is Marko's. On 2026-10-10
the branch was not pushed and had no pull request (measured: `git ls-remote` printed nothing for
it, `gh pr list` returned `[]`)
**Type:** AFK
**Lane:** deploylog-action
**Parent:** none. Backlog item E3 of the 2026-10-10 DeployLog build run; no deploylog issue number
was assigned, so this file carries none
**Lands before:** item 4 of `deploylog/issues/126-manual-verification-confirms-nothing.md` (the
Action surfacing the "vouched for nothing" result), so one v1.2.3 release and one `v1` tag move
cover both
**Blocked by:** None
**Commits:** 73c957d (action.yml), 6c0012d (esbuild target, clean dist rebuild), 70a8b47 (CI)
**Verification:** `npm run typecheck`, `npm test`, then delete `dist/`, `npm run build`, and
`git status --porcelain dist/` prints nothing. On the pull request, CI passes its dist check on
Node 24.

## The problem

`action.yml` declared `runs.using: node20`, the build bundled with `--target=node20`, and CI set up
Node 20. GitHub forces node20 actions onto Node 24, so every consumer run carries the warning
annotation "Node.js 20 is deprecated", naming `deploylogdev/action@v1` (measured on this repo's own
v1.2.2 release run, 32578620805).

## What changed

- `action.yml` `runs.using` is `node24`.
- The `package.json` build script bundles with `--target=node24`. `dist/` was deleted and rebuilt
  clean, and the bundle came out byte-identical to the committed one.
- `.github/workflows/ci.yml` sets up Node 24.
- `src/action-manifest.test.ts` asserts that `runs.using` is `node24`, and that the build target
  and every CI `node-version` equal it, so the three cannot drift apart.

## Defaults taken (not yet confirmed)

Dated 2026-10-10. Each one is reversible and none blocks the merge.

1. Three commits, one per surface (action.yml, the esbuild target, the CI node-version), each
   with its own test that was red before it. One squashed commit would serve as well.
2. The manifest test pins `runs.using` to the literal `node24`. The build-target and CI tests
   assert equality with `runs.using`, so a future bump edits one literal and the other two
   follow the manifest.
3. `@types/node` stays at `^22`. No dependency changes, and the source uses no Node 24-only API
   (inferred from a clean typecheck).
4. `ci.yml` keeps `actions/checkout@v4` and `actions/setup-node@v4`. Both declare
   `using: node20` at their `v4` tags (measured 2026-10-10, reading each repo's `action.yml` at
   `v4`), and the last two CI runs here carry the "Node.js 20 is deprecated" warning naming
   exactly those two actions (measured: runs 36226652249 and 35516024835). So this repository's
   own CI keeps showing that warning after this change (inferred: the change does not touch
   those two lines). Their `v5` tags declare `node24` (measured), so moving to `v5` would clear
   it. That is a separate change with its own behaviour to review (guess: setup-node v5 changed
   its caching defaults), so it is left out.
5. `package.json` `version` stays `1.2.2`. The bump belongs to the v1.2.3 release commit, which
   is Marko's.
6. `.github/workflows/main.yml` is untouched: 0 diff lines against `origin/main` (measured
   2026-10-10). See Marko decisions.
7. This file. The repo pruned its done issue docs in 0f11673, so the record for this change had
   no home. It lives in `issues/`, where the live docs used to sit, with no number, because the
   numbers belong to the deploylog issue sequence and none was assigned. Prune it once done,
   like the others.

## Marko decisions

- **Merge order (Marko-only merge).** Merge this once CI is green, and before the action-repo
  pull request for item 4 of deploylog issue 126, so one release covers both.
- **`.github/workflows/main.yml`.** A "Publish to DeployLog" job on `release: published` (and
  `workflow_dispatch`) that runs `deploylogdev/action@v1` with `project: your-project-slug`, a
  placeholder (measured). It has run three times, once per release v1.2.0, v1.2.1 and v1.2.2,
  and failed all three (measured: `gh run list --workflow main.yml`). The v1.2.2 run failed on
  "Input required and not supplied: api-key" (measured). The `DEPLOYLOG_API_KEY` secret exists
  since issue 62 (inferred from issue 62's status line in `git show 0f11673^`), so the v1.2.3
  release will reach the API with the placeholder slug (inferred) and most likely fail on an
  unknown project (guess). Options: keep it, set a real slug, or delete it. Left untouched here
  because it is the release path.
- **Release v1.2.3 and move `v1` (Marko-only).** Bump `package.json` `version` to `1.2.3`, tag,
  `gh release create v1.2.3`, then move the `v1` major tag to the same sha, or consumers never
  get node24. Per this repo's `CLAUDE.md`, re-tagging an existing release needs
  `gh release delete --cleanup-tag` first, or consumers stay on the old commit.

## Not verified

1. The CI dist check on Linux under Node 24. The local gate (Windows, Node 24) rebuilds `dist/`
   byte-identical to the committed bytes (measured). esbuild's output does not depend on the Node
   version running it (inferred). The pull request's CI run is the real measurement.
2. That consumer runs stop showing the warning. That is visible only after the release and the
   `v1` move. `manual-check.yml` and `main.yml` here also pin `@v1`, so they pick it up at the
   same time (inferred).
3. That runners accept `using: node24` for this action. GitHub's own `actions/checkout@v5` and
   `actions/setup-node@v5` declare `node24` (measured), so runners accept the value (inferred).
   Not seen on a live run of this action.
4. A stale fact in another repo: `deploylog/wiki/architecture.md:114` says
   "GitHub Action (node20)" (measured). It goes stale once v1.2.3 ships; an agent can fix it
   then. Not edited here because it is another repository.

## Pull request

This file is the pull request body:
`gh pr create -R deploylogdev/action --base main --head chore/node24-runtime --title "Run the Action on Node 24" --body-file issues/node24-runtime.md`
