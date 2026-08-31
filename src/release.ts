// Pure helpers for deriving DeployLog entry fields from a GitHub release payload.

export interface ReleasePayload {
  tag_name?: string | null
  name?: string | null
  body?: string | null
  prerelease?: boolean
  draft?: boolean
}

export interface DerivedRelease {
  title: string
  body: string
  /** Bare MAJOR.MINOR.PATCH, or '' when the tag carries no clean version. Never null. */
  version: string
}

/**
 * A tag, split into the release number and whatever the author appended.
 *
 * `-` opens a prerelease and `+` opens build metadata, and semver treats the two
 * very differently, which is why they are captured separately rather than as one
 * suffix group.
 */
const SEMVER = /^v?(\d+\.\d+\.\d+)(?:-([\w.-]+))?(?:\+([\w.-]+))?$/

/**
 * The version to file a release under, in the shape the server accepts.
 *
 * The server's `CreateEntrySchema.version` is
 * `z.string().regex(/^\d+\.\d+\.\d+$/).optional().or(z.literal(''))`. It takes a
 * bare number or the empty string and **rejects `null`** — which is what this
 * function used to return for every tag it could not parse, turning a user's
 * release workflow red with a 400 they had no way to read. That is BUG-027, and
 * the reason the empty string is returned rather than null is that the empty
 * string is the value the contract names.
 *
 * The two suffixes are not the same question.
 *
 * **Build metadata is dropped.** `1.0.0+build.42` is version 1.0.0; semver
 * ignores build metadata for precedence entirely. Filing it under 1.0.0 is
 * correct, and refusing it would lose a real version number over an annotation.
 *
 * **A prerelease yields no version.** `v2.0.0-beta.1` is not 2.0.0; it sorts
 * *before* it. Stripping the suffix would file the beta under the number the real
 * 2.0.0 will later claim, and two entries would then disagree about which release
 * 2.0.0 was. No number is the honest answer, and the entry still publishes with
 * its title and body. A team that does not want prereleases in the changelog at
 * all has `skip-prerelease` for that, which is a separate decision and defaults
 * off.
 */
export function extractVersion(tag: string | null | undefined): string {
  if (!tag) return ''
  const match = tag.trim().match(SEMVER)
  if (!match) return ''
  const [, release, prerelease] = match
  if (prerelease) return ''
  return release ?? ''
}

export function deriveEntryFromRelease(release: ReleasePayload): DerivedRelease {
  const tag = release.tag_name?.trim() ?? ''
  const name = release.name?.trim() ?? ''
  const body = release.body?.trim() ?? ''

  const title = name || tag || 'Release'
  const version = extractVersion(tag)

  return { title, body, version }
}
