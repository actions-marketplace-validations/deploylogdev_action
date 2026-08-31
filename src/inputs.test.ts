import { afterEach, describe, expect, it, vi } from 'vitest'
import { readInputs } from './inputs.js'

const INPUT_KEYS = [
  'INPUT_API-KEY',
  'INPUT_PROJECT',
  'INPUT_AI-SUMMARIZE',
  'INPUT_NOTIFY-SUBSCRIBERS',
  'INPUT_ENTRY-TYPE',
  'INPUT_API-URL',
  // skip-prerelease has no test that sets it today, so nothing has leaked; it is
  // listed because every other input is, and an unlisted key is a trap for
  // whoever adds that test.
  'INPUT_SKIP-PRERELEASE',
  'INPUT_MODE',
  'INPUT_FAIL-ON',
  'INPUT_GITHUB-TOKEN',
]

function setEnv(inputs: Record<string, string>): void {
  for (const key of INPUT_KEYS) delete process.env[key]
  for (const [k, v] of Object.entries(inputs)) {
    process.env[`INPUT_${k.toUpperCase()}`] = v
  }
}

afterEach(() => {
  for (const key of INPUT_KEYS) delete process.env[key]
})

describe('readInputs', () => {
  it('parses all inputs with defaults', () => {
    setEnv({ 'api-key': 'dk_abc', project: 'my-app' })
    const inputs = readInputs()
    expect(inputs).toEqual({
      apiKey: 'dk_abc',
      project: 'my-app',
      mode: 'publish',
      failOn: 'none',
      githubToken: '',
      aiSummarize: false,
      notifySubscribers: false,
      entryType: 'feature',
      apiUrl: 'https://deploylog.dev',
      skipPrerelease: false,
    })
  })

  it('masks both secret-bearing inputs before any validation can throw', () => {
    const writes: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => (writes.push(String(chunk)), true))
    setEnv({
      'api-key': 'dk_abc',
      project: 'my-app',
      'github-token': 'ghs_tokenvalue',
      // Invalid on purpose: readInputs throws on this, and the masks must
      // already be in place when it does.
      mode: 'nonsense',
    })
    expect(() => readInputs()).toThrow(/Invalid mode/)
    spy.mockRestore()
    expect(writes.join('')).toContain('::add-mask::dk_abc')
    expect(writes.join('')).toContain('::add-mask::ghs_tokenvalue')
  })

  it('parses mode and fail-on', () => {
    setEnv({ 'api-key': 'dk_abc', project: 'my-app', mode: 'VERIFY', 'fail-on': 'Drift' })
    const inputs = readInputs()
    expect(inputs.mode).toBe('verify')
    expect(inputs.failOn).toBe('drift')
  })

  it('rejects an unknown mode', () => {
    setEnv({ 'api-key': 'dk_abc', project: 'my-app', mode: 'check' })
    expect(() => readInputs()).toThrow(/Invalid mode "check"/)
  })

  it('rejects an unknown fail-on', () => {
    setEnv({ 'api-key': 'dk_abc', project: 'my-app', 'fail-on': 'always' })
    expect(() => readInputs()).toThrow(/Invalid value for fail-on/)
  })

  it('parses boolean inputs', () => {
    setEnv({
      'api-key': 'dk_abc',
      project: 'my-app',
      'ai-summarize': 'true',
      'notify-subscribers': 'true',
    })
    const inputs = readInputs()
    expect(inputs.aiSummarize).toBe(true)
    expect(inputs.notifySubscribers).toBe(true)
  })

  it('strips trailing slash from api-url', () => {
    setEnv({
      'api-key': 'dk_abc',
      project: 'my-app',
      'api-url': 'https://staging.deploylog.dev/',
    })
    expect(readInputs().apiUrl).toBe('https://staging.deploylog.dev')
  })

  it('rejects api-key that does not start with dk_', () => {
    setEnv({ 'api-key': 'wrong_abc', project: 'my-app' })
    expect(() => readInputs()).toThrow(/Invalid api-key/)
  })

  it('rejects invalid entry-type', () => {
    setEnv({ 'api-key': 'dk_abc', project: 'my-app', 'entry-type': 'bogus' })
    expect(() => readInputs()).toThrow(/Invalid entry-type/)
  })

  it('normalizes entry-type to lowercase', () => {
    setEnv({ 'api-key': 'dk_abc', project: 'my-app', 'entry-type': 'FIX' })
    expect(readInputs().entryType).toBe('fix')
  })
})
