# 27 — GitHub Action version normalization (BUG-027)

**Status:** done 2026-08-18 · **Type:** AFK · **Lane:** deploylog-action
**Parent:** ../deploylog/issues/prd-launch-security-billing-remediation.md *(PRD lives in the deploylog repo)*
**Blocked by:** None — but sequence after the deploylog server is confirmed unchanged (no server change is needed; the Action conforms to the existing schema).
**Verification:** PRD assertion 9 — failing tests to turn green in `src/release.test.ts`: `+build.42` → `1.0.0`; no clean semver → `''` or omitted (never `null`); the resulting payload validates against the server's `CreateEntrySchema.version` shape. Signal: `vitest run`.

> Relocated here from `deploylog/issues/` on 2026-07-02: it edits this repo, and the deploylog
> AFK night-loop branches the deploylog repo, so it would misfire there. Not armed for the same
> night as the deploylog remediation run (avoids double-drawing the nightly rate ceiling).

## What to build

Make the Action's derived version conform to the server's `CreateEntrySchema.version`
(`.regex(/^\d+\.\d+\.\d+$/).optional().or(z.literal(''))` — accepts `undefined`/`''`, **rejects
`null`**). Today `extractVersion` preserves suffixes and the Action can send `null`, both of which
400 and turn a user's release workflow red.

- For a stable tag with a suffix (`v1.0.0+build.42`), send `1.0.0`.
- When there is no clean `MAJOR.MINOR.PATCH`, **omit the field or send `''`, never `null`**.
- Reconcile with BUG-016 (already shipped): prerelease skipping is on by default, so `-rc.1` tags
  are gated before `extractVersion` and stripping them would collide with the later real `2.0.0` —
  so the target case is stable-with-suffix and the `null`-vs-`''` schema bug, not prereleases.
- Update `release.test.ts` (currently asserts suffix *preservation*) and rebuild `dist/` cleanly.

## Acceptance criteria

- [x] `extractVersion` emits bare `MAJOR.MINOR.PATCH` or `''`. Its return type is now `string`, so
      `null` is unrepresentable rather than merely unwanted, and `CreateEntryInput.version` was
      tightened the same way.
- [x] Tests assert `+build.42` to `1.0.0` and the no-clean-semver path to `''`. The contract arm
      copies the server regex verbatim and asserts twelve tags against it, so the check is against
      the schema shape rather than against remembered behaviour.
- [x] `dist/` rebuilt cleanly via `npm run package` and committed.
- [x] `vitest run` passes: 88 tests, typecheck exit 0.

## Run record — 2026-08-18

**The issue's premise was wrong, and it widened the fix.** This issue says prerelease skipping "is
on by default, so `-rc.1` tags are gated before `extractVersion`". It is not: `inputs.ts:53` reads
`readBool('skip-prerelease', false)` and `action.yml` defaults it to `"false"`. Prereleases reach
`extractVersion` on a default install, and the server rejects `2.0.0-beta.1` exactly as it rejects
`1.0.0+build.42`. So the target case was never just build metadata plus the null bug.

**The two suffixes needed opposite answers, which is why the regex captures them separately.**

- `1.0.0+build.42` to `1.0.0`. Build metadata is ignored in semver precedence, so the tag names
  version 1.0.0 and refusing it would lose a real number over an annotation.
- `v2.0.0-beta.1` to `''`. A prerelease sorts *before* the release it names. Stripping it would file
  the beta under the number the real 2.0.0 later claims, and two entries would then disagree about
  which release 2.0.0 was. This is the collision this issue warned about; the answer is no version,
  not a stripped one. The entry still publishes with its title and body, and a team that wants
  prereleases out of the changelog entirely has `skip-prerelease`.

**Calibrated, not just covered.** Two mutants: stripping the prerelease instead of refusing it turns
1 test red, and returning `null` for an empty tag turns 4 red.

**Caught by the widened typecheck, not by the tests.** Tightening `CreateEntryInput.version` to
`string` surfaced three call sites in `api.test.ts` still constructing `version: null` — the exact
payload the server 400s on. All 88 tests passed while those sat there. That gate was widened in
issue 55's review pass, and this is the first defect it caught.
