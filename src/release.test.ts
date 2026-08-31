import { describe, expect, it } from 'vitest'
import { deriveEntryFromRelease, extractVersion } from './release.js'

/**
 * The server's `CreateEntrySchema.version`, copied verbatim from
 * `deploylog/src/lib/schemas.ts`:
 *
 *   z.string().regex(/^\d+\.\d+\.\d+$/).optional().or(z.literal(''))
 *
 * It accepts bare MAJOR.MINOR.PATCH or the empty string, and rejects `null` and
 * every suffix. Asserting against the shape rather than against remembered
 * behaviour is the point of BUG-027: the Action held a second, wrong copy of
 * this contract and the 400 was how anyone found out.
 */
const serverAccepts = (version: unknown): boolean =>
  version === undefined || version === '' || (typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version))

describe('extractVersion', () => {
  it('strips leading v from semver tags', () => {
    expect(extractVersion('v1.2.3')).toBe('1.2.3')
    expect(extractVersion('1.2.3')).toBe('1.2.3')
  })

  it('drops build metadata, which names the same version', () => {
    // +build.42 is ignored in semver precedence: it IS 1.0.0, so the entry
    // should carry 1.0.0 rather than nothing.
    expect(extractVersion('1.0.0+build.42')).toBe('1.0.0')
    expect(extractVersion('v2.3.4+exp.sha.5114f85')).toBe('2.3.4')
  })

  it('refuses a prerelease rather than stripping it to the release it is not', () => {
    // v2.0.0-beta.1 is NOT version 2.0.0; it sorts before it. Stripping the
    // suffix would file the beta under the number the real 2.0.0 will later
    // claim, so the honest answer is no version at all.
    expect(extractVersion('v2.0.0-beta.1')).toBe('')
    expect(extractVersion('v1.0.0-rc.1')).toBe('')
  })

  it('returns the empty string, never null, for a tag with no clean semver', () => {
    // The whole of BUG-027: the server rejects null and accepts ''.
    for (const tag of ['release-2026-04', 'v1.2', '', null, undefined]) {
      expect(extractVersion(tag)).toBe('')
    }
  })

  it('emits nothing the server would reject', () => {
    const tags = [
      'v1.2.3', '1.2.3', '1.0.0+build.42', 'v2.0.0-beta.1', 'v1.0.0-rc.1',
      'release-2026-04', 'v1.2', 'v1.2.3.4', 'vv1.2.3', '  ', 'latest', '',
    ]
    for (const tag of tags) {
      const version = extractVersion(tag)
      expect(version).not.toBeNull()
      expect(serverAccepts(version), `tag ${JSON.stringify(tag)} produced ${JSON.stringify(version)}`).toBe(true)
    }
  })
})

describe('deriveEntryFromRelease', () => {
  it('uses release.name when present', () => {
    const result = deriveEntryFromRelease({
      tag_name: 'v1.2.3',
      name: 'Spring Update',
      body: '## Features\n- New stuff',
    })
    expect(result.title).toBe('Spring Update')
    expect(result.body).toBe('## Features\n- New stuff')
    expect(result.version).toBe('1.2.3')
  })

  it('falls back to tag when name is empty', () => {
    const result = deriveEntryFromRelease({
      tag_name: 'v1.2.3',
      name: '',
      body: 'notes',
    })
    expect(result.title).toBe('v1.2.3')
  })

  it('falls back to "Release" when name and tag are empty', () => {
    const result = deriveEntryFromRelease({ tag_name: '', name: '', body: '' })
    expect(result.title).toBe('Release')
    expect(result.body).toBe('')
    expect(result.version).toBe('')
  })

  it('trims whitespace on all fields', () => {
    const result = deriveEntryFromRelease({
      tag_name: '  v1.0.0  ',
      name: '  Hello  ',
      body: '  body  ',
    })
    expect(result.title).toBe('Hello')
    expect(result.body).toBe('body')
    expect(result.version).toBe('1.0.0')
  })

  it('handles null fields gracefully', () => {
    const result = deriveEntryFromRelease({
      tag_name: null,
      name: null,
      body: null,
    })
    expect(result.title).toBe('Release')
    expect(result.body).toBe('')
    expect(result.version).toBe('')
  })

  it('derives an empty version from a non-semver tag, not null', () => {
    const result = deriveEntryFromRelease({
      tag_name: 'release-q2-2026',
      name: 'Q2 Release',
      body: 'notes',
    })
    expect(result.version).toBe('')
    expect(result.title).toBe('Q2 Release')
  })
})
