import { describe, expect, it, vi } from 'vitest'
import { createApiClient, ApiError } from './api.js'

function makeFetch(
  response: { ok?: boolean; status?: number; body: unknown; text?: string },
): typeof fetch {
  const body = response.text ?? JSON.stringify(response.body)
  const ok = response.ok ?? true
  const status = response.status ?? (ok ? 200 : 400)
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => body,
  }) as unknown as typeof fetch
}

describe('createApiClient', () => {
  it('posts the verify request verbatim and unwraps the report', async () => {
    const report = {
      chapters: [],
      confirmedCount: 0,
      errorCount: 0,
      unanchoredCount: 0,
      evaluatedCount: 3,
      skippedCount: 1,
      lowCoverageChapters: [],
      untriggeredCount: 2,
      unverifiable: true,
    }
    const fetchFn = makeFetch({ body: { data: report } })
    const client = createApiClient({
      baseUrl: 'https://deploylog.dev',
      apiKey: 'dk_test',
      fetchFn,
    })

    const result = await client.verifyManual({
      project: 'my-app',
      repository: 'marko-builds/deploylog',
      ref: 'a'.repeat(40),
      changedFiles: ['src/lib/limits.ts'],
    })

    expect(result.untriggeredCount).toBe(2)
    const mockFetch = fetchFn as unknown as ReturnType<typeof vi.fn>
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://deploylog.dev/api/cli/manual/verify')
    expect(init.method).toBe('POST')
    // The request schema is `.strict()`: an extra field is a 400, not a strip.
    // Asserting the exact key set is the only thing that catches a helpful
    // addition here before a live run does.
    expect(Object.keys(JSON.parse(init.body as string)).sort()).toEqual([
      'changedFiles',
      'project',
      'ref',
      'repository',
    ])
  })

  it('surfaces a verify 404 as an ApiError carrying the status', async () => {
    const fetchFn = makeFetch({
      ok: false,
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: "Project 'my-app' has no manual to verify" } },
    })
    const client = createApiClient({
      baseUrl: 'https://deploylog.dev',
      apiKey: 'dk_test',
      fetchFn,
    })

    await expect(
      client.verifyManual({
        project: 'my-app',
        repository: 'marko-builds/deploylog',
        ref: 'a'.repeat(40),
        changedFiles: null,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('sends Bearer auth and JSON body to createEntry', async () => {
    const fetchFn = makeFetch({
      body: {
        data: {
          id: 'entry-1',
          slug: 'foo',
          published: false,
          title: 'Foo',
          version: '1.0.0',
        },
      },
    })
    const client = createApiClient({
      baseUrl: 'https://deploylog.dev',
      apiKey: 'dk_test',
      fetchFn,
    })

    const result = await client.createEntry('my-app', {
      title: 'Foo',
      body_markdown: 'notes',
      entry_type: 'feature',
      version: '1.0.0',
      publish: true,
    })

    expect(result.id).toBe('entry-1')
    const mockFetch = fetchFn as unknown as ReturnType<typeof vi.fn>
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://deploylog.dev/api/cli/projects/my-app/entries')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer dk_test')
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(
      JSON.stringify({
        title: 'Foo',
        body_markdown: 'notes',
        entry_type: 'feature',
        version: '1.0.0',
        publish: true,
      }),
    )
  })

  it('URL-encodes the project slug', async () => {
    const fetchFn = makeFetch({
      body: { data: { id: 'x', slug: 'x', published: false, title: 'x', version: null } },
    })
    const client = createApiClient({ baseUrl: 'https://api.test', apiKey: 'dk_k', fetchFn })
    await client.createEntry('weird/slug', {
      title: 't',
      body_markdown: 'b',
      entry_type: 'fix',
      version: '',
      publish: false,
    })
    const mockFetch = fetchFn as unknown as ReturnType<typeof vi.fn>
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('https://api.test/api/cli/projects/weird%2Fslug/entries')
  })

  it('throws ApiError with server message on non-2xx', async () => {
    const fetchFn = makeFetch({
      ok: false,
      status: 429,
      body: {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'Free tier exhausted for this month.',
        },
      },
    })
    const client = createApiClient({ baseUrl: 'https://api.test', apiKey: 'dk_k', fetchFn })

    await expect(
      client.summarize({ project_slug: 'p', release_notes: 'notes' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      code: 'QUOTA_EXCEEDED',
      message: 'Free tier exhausted for this month.',
    })
  })

  it('falls back to generic message when no error body', async () => {
    const fetchFn = makeFetch({ ok: false, status: 500, text: '', body: null })
    const client = createApiClient({ baseUrl: 'https://api.test', apiKey: 'dk_k', fetchFn })
    await expect(
      client.createEntry('p', {
        title: 't',
        body_markdown: 'b',
        entry_type: 'feature',
        version: '',
        publish: false,
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('unwraps { data } envelope when present', async () => {
    const fetchFn = makeFetch({
      body: {
        data: {
          summary: {
            title: 'Clean notes',
            entry_type: 'feature',
            body_markdown: '**New**\n- thing',
          },
          model: 'claude-haiku-4-5',
          usage: { used: 1, limit: 5, month_key: '2026-04' },
        },
      },
    })
    const client = createApiClient({ baseUrl: 'https://api.test', apiKey: 'dk_k', fetchFn })
    const res = await client.summarize({ project_slug: 'p', release_notes: 'notes' })
    expect(res.summary.title).toBe('Clean notes')
    expect(res.model).toBe('claude-haiku-4-5')
    expect(res.usage.limit).toBe(5)
  })

  it('accepts payloads without data envelope', async () => {
    const fetchFn = makeFetch({
      body: { id: 'entry-raw', slug: 's', published: false, title: 't', version: null },
    })
    const client = createApiClient({ baseUrl: 'https://api.test', apiKey: 'dk_k', fetchFn })
    const res = await client.createEntry('p', {
      title: 't',
      body_markdown: 'b',
      entry_type: 'feature',
      version: '',
      publish: false,
    })
    expect(res.id).toBe('entry-raw')
  })
})
