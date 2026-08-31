import * as core from '@actions/core'
import { parseFailOn, type FailOn } from './verdict.js'

export type EntryType = 'feature' | 'fix' | 'improvement' | 'breaking' | 'announcement'

const ENTRY_TYPES: readonly EntryType[] = [
  'feature',
  'fix',
  'improvement',
  'breaking',
  'announcement',
] as const

/**
 * What the Action is being asked to do. Explicit rather than inferred from
 * `github.context.eventName`, because a workflow that already runs on both
 * `release` and `push` would start running verify on pushes nobody opted into.
 */
export type ActionMode = 'publish' | 'verify'

const MODES: readonly ActionMode[] = ['publish', 'verify'] as const

export interface ActionInputs {
  apiKey: string
  project: string
  mode: ActionMode
  failOn: FailOn
  /** For reading a pull request's changed files. Empty when not supplied. */
  githubToken: string
  aiSummarize: boolean
  notifySubscribers: boolean
  entryType: EntryType
  apiUrl: string
  skipPrerelease: boolean
}

export function readInputs(): ActionInputs {
  const apiKey = core.getInput('api-key', { required: true }).trim()
  // Masked here rather than after validation. BUG-016's point is that the value
  // may have been pasted as a literal instead of wired through `secrets.*`, and
  // every validation below can throw — a throw before the mask is a throw with an
  // unmasked secret already in the process.
  core.setSecret(apiKey)

  const githubToken = core.getInput('github-token').trim()
  if (githubToken) core.setSecret(githubToken)

  const project = core.getInput('project', { required: true }).trim()
  const modeRaw = (core.getInput('mode') || 'publish').trim().toLowerCase()
  const failOn = parseFailOn(core.getInput('fail-on'))
  const aiSummarize = readBool('ai-summarize', false)
  const notifySubscribers = readBool('notify-subscribers', false)
  const skipPrerelease = readBool('skip-prerelease', false)
  const entryTypeRaw = (core.getInput('entry-type') || 'feature').trim().toLowerCase()
  const apiUrl = (core.getInput('api-url') || 'https://deploylog.dev').trim().replace(/\/+$/, '')

  if (!apiKey.startsWith('dk_')) {
    throw new Error('Invalid api-key. Keys issued by DeployLog start with "dk_".')
  }

  if (!isMode(modeRaw)) {
    throw new Error(`Invalid mode "${modeRaw}". Must be one of: ${MODES.join(', ')}`)
  }

  if (!isEntryType(entryTypeRaw)) {
    throw new Error(
      `Invalid entry-type "${entryTypeRaw}". Must be one of: ${ENTRY_TYPES.join(', ')}`,
    )
  }

  return {
    apiKey,
    project,
    mode: modeRaw,
    failOn,
    githubToken,
    aiSummarize,
    notifySubscribers,
    entryType: entryTypeRaw,
    apiUrl,
    skipPrerelease,
  }
}

function isMode(value: string): value is ActionMode {
  return (MODES as readonly string[]).includes(value)
}

function isEntryType(value: string): value is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(value)
}

function readBool(name: string, defaultValue: boolean): boolean {
  const raw = core.getInput(name).trim().toLowerCase()
  if (!raw) return defaultValue
  if (['true', '1', 'yes'].includes(raw)) return true
  if (['false', '0', 'no'].includes(raw)) return false
  throw new Error(`Invalid value for ${name}: "${raw}". Expected true or false.`)
}
