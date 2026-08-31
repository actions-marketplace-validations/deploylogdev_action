import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Reads the real action.yml, not a fixture. The defect this guards shipped in
 * v1.2.0 and made the action fail to load for every consumer, in both modes,
 * before any input was read — and it passed a full typecheck, 88 tests and a
 * clean dist build, because nothing in the repo looked at this file at all.
 */
const MANIFEST = fileURLToPath(new URL('../action.yml', import.meta.url))

describe('action.yml', () => {
  it('contains no expression syntax anywhere', () => {
    // GitHub evaluates `${{ }}` in action.yml metadata, DESCRIPTIONS INCLUDED.
    // `github` is not a context that exists at load time, so one interpolation
    // in a description is not documentation, it is a parse error for everyone.
    // Built from fragments so this assertion cannot trip over itself.
    const marker = '$' + '{{'
    const source = readFileSync(MANIFEST, 'utf8')
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter((entry) => entry.text.includes(marker))

    expect(offenders, `action.yml lines carrying expression syntax: ${JSON.stringify(offenders)}`)
      .toEqual([])
  })

  it('declares every input readInputs asks for', () => {
    // The other half of the same blind spot: nothing tied the manifest to the
    // code. An input read but never declared is empty at runtime with no error.
    const source = readFileSync(MANIFEST, 'utf8')
    const declared = new Set(
      source
        .split('\n')
        .map((line) => /^ {2}([a-z][\w-]*):$/.exec(line)?.[1])
        .filter((name): name is string => Boolean(name)),
    )
    const inputsSource = readFileSync(fileURLToPath(new URL('./inputs.ts', import.meta.url)), 'utf8')
    const read = [...inputsSource.matchAll(/getInput\('([^']+)'/g)].map((m) => m[1] as string)

    expect(read.length).toBeGreaterThan(0)
    for (const name of read) {
      expect(declared.has(name), `getInput('${name}') has no declaration in action.yml`).toBe(true)
    }
  })
})
