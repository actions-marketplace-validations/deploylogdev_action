import type { EntryType } from './inputs.js'

export interface CreateEntryInput {
  title: string
  body_markdown: string
  entry_type: EntryType
  /**
   * Bare MAJOR.MINOR.PATCH, or '' for no version. **Not nullable**, and that is
   * load-bearing rather than tidy: the server's `CreateEntrySchema.version`
   * rejects `null` outright, so the old `string | null` here was a type that
   * permitted the exact payload the API 400s on. That was BUG-027.
   */
  version: string
  publish: boolean
}

export interface CreatedEntry {
  id: string
  slug: string
  published: boolean
  title: string
  version: string | null
}

export interface AiSummary {
  title: string
  entry_type: EntryType
  body_markdown: string
}

export interface SummarizeInput {
  project_slug: string
  release_notes: string
  version?: string | null
}

export interface SummarizeResponse {
  summary: AiSummary
  model: string
  usage: { used: number; limit: number | null; month_key: string }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientConfig {
  baseUrl: string
  apiKey: string
  userAgent?: string
  fetchFn?: typeof fetch
}

export function createApiClient(config: ApiClientConfig) {
  const fetchFn = config.fetchFn ?? fetch
  const userAgent = config.userAgent ?? 'deploylog-action/1.2'

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchFn(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'User-Agent': userAgent,
        ...(init.headers ?? {}),
      },
    })

    const text = await res.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        // non-JSON body; leave payload null
      }
    }

    if (!res.ok) {
      const errObj = extractError(payload)
      throw new ApiError(
        errObj.message ?? `Request failed with status ${res.status}`,
        res.status,
        errObj.code,
      )
    }

    const data = extractData(payload)
    return data as T
  }

  async function createEntry(projectSlug: string, input: CreateEntryInput): Promise<CreatedEntry> {
    return request<CreatedEntry>(`/api/cli/projects/${encodeURIComponent(projectSlug)}/entries`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async function summarize(input: SummarizeInput): Promise<SummarizeResponse> {
    return request<SummarizeResponse>('/api/cli/ai-summarize', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /**
   * Read-only. The route mutates nothing, so the API key needs `read` permission
   * and nothing more. The response arrives wrapped as `{ data: <report> }`, which
   * `request` already unwraps.
   */
  async function verifyManual(input: ManualVerifyRequest): Promise<VerificationReport> {
    return request<VerificationReport>('/api/cli/manual/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  return { createEntry, summarize, verifyManual }
}

function extractError(payload: unknown): { message?: string; code?: string } {
  if (!payload || typeof payload !== 'object') return {}
  const p = payload as Record<string, unknown>
  const err = p.error
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const out: { message?: string; code?: string } = {}
    if (typeof e.message === 'string') out.message = e.message
    if (typeof e.code === 'string') out.code = e.code
    return out
  }
  if (typeof p.message === 'string') return { message: p.message }
  return {}
}

function extractData(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data
  }
  return payload
}

// --- Manual verification (issue 55) ---
//
// A mirror of the endpoint's *wire* contract, `ManualVerifyRequestSchema` and
// `ManualVerifyResponseSchema` in the deploylog repository's `src/lib/schemas.ts`.
// Deliberately not a mirror of `manual-verification.ts`: the service type is what
// the checker computes, the schema is what crosses the boundary, and the route
// validates the report against the schema on the way out precisely so the two can
// differ. Mirroring the wrong one is how BUG-027 happened.

export const VERIFY_VERDICTS = [
  'CONFIRMED',
  'SUSPECT',
  'CLEAR',
  'ERROR',
  'UNANCHORED',
] as const

export type VerifyVerdict = (typeof VERIFY_VERDICTS)[number]

export const VERIFY_ERROR_REASONS = [
  'no_access',
  'not_found',
  'not_configured',
  'unavailable',
  'invalid_request',
  'unmapped_repository',
  'missing_symbol',
  'malformed_claim',
  'unsupported_value',
] as const

export type VerifyErrorReason = (typeof VERIFY_ERROR_REASONS)[number]

/**
 * The request body. The schema is `.strict()`, so an unknown field is a 400 and
 * not a silent strip — this interface is exact on purpose.
 *
 * `project` is the DeployLog project slug, never a version id; the route resolves
 * that project's working version. `ref` is a full 40-character sha. `changedFiles`
 * is a list of repository-relative paths, or null for a full sweep — paths only,
 * because the server pairs them with `repository` so that a run cannot declare a
 * change in a repository it is not running in.
 */
export interface ManualVerifyRequest {
  project: string
  repository: string
  ref: string
  changedFiles: string[] | null
}

export interface VerifyConfirmedFinding {
  claimId: string
  text: string
  repository: string
  source: string
  /** Where the value sits now, or null when the finding is a disappearance. */
  line: number | null
  detail: string
}

export interface VerifyErrorFinding {
  claimId: string
  text: string
  repository: string
  source: string
  reason: VerifyErrorReason
  detail: string
}

export interface VerifyUntriggeredFinding {
  claimId: string
  text: string
  repository: string
}

export interface VerifyCoverage {
  sentences: number
  measurable: number
  claimed: number
  ratio: number | null
  unclaimed: string[]
}

export interface VerifyChapterResult {
  number: string
  title: string
  state: VerifyVerdict
  confirmed: VerifyConfirmedFinding[]
  errors: VerifyErrorFinding[]
  touched: string[]
  coverage: VerifyCoverage
  untriggered: VerifyUntriggeredFinding[]
}

export interface VerificationReport {
  chapters: VerifyChapterResult[]
  confirmedCount: number
  errorCount: number
  unanchoredCount: number
  evaluatedCount: number
  skippedCount: number
  lowCoverageChapters: string[]
  untriggeredCount: number
  unverifiable: boolean
}
