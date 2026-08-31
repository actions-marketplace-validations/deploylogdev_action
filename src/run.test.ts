import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from './run.js'
import type { ActionInputs } from './inputs.js'
import type { ActionLogger } from './run.js'
import type { ReleasePayload } from './release.js'

function makeLogger(): ActionLogger & {
  outputs: Record<string, string>
  failures: string[]
  messages: string[]
} {
  const outputs: Record<string, string> = {}
  const failures: string[] = []
  const messages: string[] = []
  return {
    info: (m) => messages.push(m),
    warning: (m) => messages.push(m),
    debug: (m) => messages.push(m),
    setOutput: (name, value) => {
      outputs[name] = value
    },
    setFailed: (m) => failures.push(m),
    annotate: () => {},
    summary: () => {},
    outputs,
    failures,
    messages,
  }
}

const baseInputs: ActionInputs = {
  apiKey: 'dk_test',
  project: 'my-app',
  mode: 'publish',
  failOn: 'none',
  githubToken: '',
  aiSummarize: false,
  notifySubscribers: false,
  entryType: 'feature',
  apiUrl: 'https://deploylog.dev',
  skipPrerelease: false,
}

interface FakeClient {
  createEntry: ReturnType<typeof vi.fn>
  summarize: ReturnType<typeof vi.fn>
  verifyManual?: ReturnType<typeof vi.fn>
}

function makeClientFactory(client: FakeClient) {
  return () => client as unknown as ReturnType<typeof import('./api.js').createApiClient>
}

describe('run', () => {
  let logger: ReturnType<typeof makeLogger>
  let client: FakeClient

  beforeEach(() => {
    logger = makeLogger()
    client = {
      createEntry: vi.fn().mockResolvedValue({
        id: 'entry-1',
        slug: 'spring-update',
        published: false,
        title: 'Spring Update',
        version: '1.2.3',
      }),
      summarize: vi.fn(),
    }
  })

  it('fails cleanly when no release payload is present', async () => {
    await run({ inputs: baseInputs, release: null, logger, clientFactory: makeClientFactory(client) })
    expect(logger.failures[0]).toMatch(/must run on `release` events/)
    expect(client.createEntry).not.toHaveBeenCalled()
  })

  it('skips prereleases when skip-prerelease is set', async () => {
    const release: ReleasePayload = {
      tag_name: 'v2.0.0-rc.1',
      name: 'RC',
      body: 'notes',
      prerelease: true,
    }
    await run({
      inputs: { ...baseInputs, skipPrerelease: true },
      release,
      logger,
      clientFactory: makeClientFactory(client),
    })
    expect(logger.failures).toEqual([])
    expect(client.createEntry).not.toHaveBeenCalled()
  })

  it('publishes prereleases when skip-prerelease is not set', async () => {
    const release: ReleasePayload = {
      tag_name: 'v2.0.0-rc.1',
      name: 'RC',
      body: 'notes',
      prerelease: true,
    }
    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })
    expect(logger.failures).toEqual([])
    expect(client.createEntry).toHaveBeenCalled()
  })

  it('skips draft releases without creating an entry', async () => {
    const release: ReleasePayload = {
      tag_name: 'v1.0.0',
      name: 'Draft',
      body: 'notes',
      draft: true,
    }
    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })
    expect(logger.failures).toEqual([])
    expect(client.createEntry).not.toHaveBeenCalled()
    expect(logger.messages.some((m) => m.includes('draft'))).toBe(true)
  })

  it('creates a draft entry when notify-subscribers is false', async () => {
    const release: ReleasePayload = {
      tag_name: 'v1.2.3',
      name: 'Spring Update',
      body: '## New\n- feature one',
    }
    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })

    expect(client.createEntry).toHaveBeenCalledWith('my-app', {
      title: 'Spring Update',
      body_markdown: '## New\n- feature one',
      entry_type: 'feature',
      version: '1.2.3',
      publish: false,
    })
    expect(logger.outputs['ai-used']).toBe('false')
    expect(logger.outputs['entry-id']).toBe('entry-1')
    expect(logger.outputs['entry-slug']).toBe('spring-update')
    expect(logger.outputs['entry-published']).toBe('false')
  })

  it('publishes when notify-subscribers is true', async () => {
    client.createEntry.mockResolvedValueOnce({
      id: 'entry-2',
      slug: 'spring-update',
      published: true,
      title: 'Spring Update',
      version: '1.2.3',
    })
    const release: ReleasePayload = {
      tag_name: 'v1.2.3',
      name: 'Spring Update',
      body: 'notes',
    }
    await run({
      inputs: { ...baseInputs, notifySubscribers: true },
      release,
      logger,
      clientFactory: makeClientFactory(client),
    })
    expect(client.createEntry).toHaveBeenCalledWith(
      'my-app',
      expect.objectContaining({ publish: true }),
    )
    expect(logger.outputs['entry-published']).toBe('true')
  })

  it('calls summarize then createEntry when ai-summarize is true', async () => {
    client.summarize.mockResolvedValueOnce({
      summary: {
        title: 'Faster Uploads',
        entry_type: 'improvement',
        body_markdown: '**New**\n- Upload speeds are 3x faster.',
      },
      model: 'claude-haiku-4-5',
      usage: { used: 1, limit: 5, month_key: '2026-04' },
    })
    const release: ReleasePayload = {
      tag_name: 'v1.2.3',
      name: 'Release',
      body: 'raw commits\n- upgrade: bump multer',
    }
    await run({
      inputs: { ...baseInputs, aiSummarize: true },
      release,
      logger,
      clientFactory: makeClientFactory(client),
    })
    expect(client.summarize).toHaveBeenCalledWith({
      project_slug: 'my-app',
      release_notes: 'raw commits\n- upgrade: bump multer',
      version: '1.2.3',
    })
    expect(client.createEntry).toHaveBeenCalledWith('my-app', {
      title: 'Faster Uploads',
      body_markdown: '**New**\n- Upload speeds are 3x faster.',
      entry_type: 'improvement',
      version: '1.2.3',
      publish: false,
    })
    expect(logger.outputs['ai-used']).toBe('true')
  })

  it('fails when ai-summarize is enabled but release body is empty', async () => {
    const release: ReleasePayload = {
      tag_name: 'v1.0.0',
      name: 'Empty',
      body: '',
    }
    await run({
      inputs: { ...baseInputs, aiSummarize: true },
      release,
      logger,
      clientFactory: makeClientFactory(client),
    })
    expect(logger.failures[0]).toMatch(/release body is empty/)
    expect(client.summarize).not.toHaveBeenCalled()
    expect(client.createEntry).not.toHaveBeenCalled()
  })

  it('fails when release has no body and ai-summarize is off', async () => {
    const release: ReleasePayload = {
      tag_name: 'v1.0.0',
      name: 'Empty',
      body: '',
    }
    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })
    expect(logger.failures[0]).toMatch(/no body to publish/)
    expect(client.createEntry).not.toHaveBeenCalled()
  })

  it('surfaces summarize errors without creating an entry', async () => {
    client.summarize.mockRejectedValueOnce(new Error('quota exceeded'))
    const release: ReleasePayload = {
      tag_name: 'v1.0.0',
      name: 'Release',
      body: 'raw notes',
    }
    await run({
      inputs: { ...baseInputs, aiSummarize: true },
      release,
      logger,
      clientFactory: makeClientFactory(client),
    })
    expect(logger.failures[0]).toMatch(/AI summarization failed: quota exceeded/)
    expect(client.createEntry).not.toHaveBeenCalled()
  })

  it('surfaces createEntry errors as setFailed', async () => {
    client.createEntry.mockRejectedValueOnce(new Error('project not found'))
    const release: ReleasePayload = {
      tag_name: 'v1.0.0',
      name: 'Release',
      body: 'notes',
    }
    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })
    expect(logger.failures[0]).toMatch(/Failed to create DeployLog entry: project not found/)
  })

  it('sends an empty version, never null, when the tag is not semver', async () => {
    // BUG-027. The server's version field rejects null and accepts '', so the
    // old behaviour asserted here turned a user's release workflow red with a
    // 400. The entry still publishes; it just carries no version number.
    const release: ReleasePayload = {
      tag_name: 'spring-2026',
      name: 'Spring 2026',
      body: 'notes',
    }
    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })
    expect(client.createEntry).toHaveBeenCalledWith(
      'my-app',
      expect.objectContaining({ version: '' }),
    )
  })

  it('sends the bare number for a tag carrying build metadata', async () => {
    const release: ReleasePayload = {
      tag_name: 'v1.0.0+build.42',
      name: 'Build 42',
      body: 'notes',
    }
    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })
    expect(client.createEntry).toHaveBeenCalledWith(
      'my-app',
      expect.objectContaining({ version: '1.0.0' }),
    )
  })
})

describe('run mode dispatch', () => {
  const release: ReleasePayload = {
    tag_name: 'v1.2.3',
    name: 'Spring Update',
    body: 'Some notes',
    draft: false,
    prerelease: false,
  }

  it('publishes on the default mode and never touches the verify endpoint', async () => {
    // Criterion 6: an existing release-triggered workflow is unaffected by the
    // upgrade. The default is publish, and nothing about a verify surface reaches it.
    const logger = makeLogger()
    const client = {
      createEntry: vi.fn().mockResolvedValue({
        id: 'entry-1',
        slug: 'spring-update',
        published: false,
        title: 'Spring Update',
        version: '1.2.3',
      }),
      summarize: vi.fn(),
      verifyManual: vi.fn(),
    }

    await run({ inputs: baseInputs, release, logger, clientFactory: makeClientFactory(client) })

    expect(logger.failures).toEqual([])
    expect(client.createEntry).toHaveBeenCalledTimes(1)
    expect(client.verifyManual).not.toHaveBeenCalled()
  })

  it('routes to verify and never publishes when mode is verify', async () => {
    const logger = makeLogger()
    const client = {
      createEntry: vi.fn(),
      summarize: vi.fn(),
      verifyManual: vi.fn().mockResolvedValue({
        chapters: [],
        confirmedCount: 0,
        errorCount: 0,
        unanchoredCount: 0,
        evaluatedCount: 1,
        skippedCount: 0,
        lowCoverageChapters: [],
        untriggeredCount: 0,
        unverifiable: false,
      }),
    }

    await run({
      inputs: { ...baseInputs, mode: 'verify' },
      release,
      verify: { repository: 'marko-builds/deploylog', ref: 'e'.repeat(40), changedFiles: null },
      logger,
      clientFactory: makeClientFactory(client),
    })

    expect(logger.failures).toEqual([])
    expect(client.verifyManual).toHaveBeenCalledTimes(1)
    // A release payload is present and is ignored: mode decides, the event does not.
    expect(client.createEntry).not.toHaveBeenCalled()
  })

  it('fails rather than guessing when verify mode has no context', async () => {
    const logger = makeLogger()
    const client = { createEntry: vi.fn(), summarize: vi.fn(), verifyManual: vi.fn() }

    await run({
      inputs: { ...baseInputs, mode: 'verify' },
      release,
      verify: null,
      logger,
      clientFactory: makeClientFactory(client),
    })

    expect(logger.failures[0]).toContain('no repository and ref')
    expect(client.verifyManual).not.toHaveBeenCalled()
  })
})
