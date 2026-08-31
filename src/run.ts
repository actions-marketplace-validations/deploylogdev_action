import type { ActionInputs } from './inputs.js'
import type { ApiClientConfig } from './api.js'
import { createApiClient } from './api.js'
import type { ReleasePayload } from './release.js'
import { deriveEntryFromRelease } from './release.js'
import type { Annotation } from './annotate.js'
import type { VerifyContext } from './verify-context.js'
import { runVerify } from './verify.js'

export interface ActionLogger {
  info(msg: string): void
  warning(msg: string): void
  debug(msg: string): void
  setOutput(name: string, value: string): void
  setFailed(msg: string): void
  /** One inline annotation on a line of the diff. */
  annotate(annotation: Annotation, level: 'warning' | 'error'): void
  /** The job summary. Markdown, written once. */
  summary(markdown: string): Promise<void> | void
}

export interface RunOptions {
  inputs: ActionInputs
  release: ReleasePayload | null
  /** Present only in verify mode; the caller resolves it from the event. */
  verify?: VerifyContext | null
  logger: ActionLogger
  clientFactory?: (config: ApiClientConfig) => ReturnType<typeof createApiClient>
}

export async function run(opts: RunOptions): Promise<void> {
  if (opts.inputs.mode === 'verify') {
    if (!opts.verify) {
      opts.logger.setFailed('mode is `verify` but this run has no repository and ref to verify at.')
      return
    }
    return runVerify({
      inputs: opts.inputs,
      context: opts.verify,
      logger: opts.logger,
      ...(opts.clientFactory ? { clientFactory: opts.clientFactory } : {}),
    })
  }
  return runPublish(opts)
}

async function runPublish(opts: RunOptions): Promise<void> {
  const { inputs, release, logger } = opts

  if (!release) {
    logger.setFailed(
      'No release found in event payload. This action must run on `release` events ' +
        '(e.g. `on: release: types: [published]`).',
    )
    return
  }

  if (release.draft) {
    logger.info('Release is marked as draft. Skipping DeployLog entry.')
    return
  }

  if (inputs.skipPrerelease && release.prerelease) {
    logger.info('Release is a prerelease and skip-prerelease is set. Skipping DeployLog entry.')
    return
  }

  const derived = deriveEntryFromRelease(release)
  const factory = opts.clientFactory ?? createApiClient
  const client = factory({ baseUrl: inputs.apiUrl, apiKey: inputs.apiKey })

  let title = derived.title
  let body = derived.body
  let entryType = inputs.entryType
  let aiUsed = false

  if (inputs.aiSummarize) {
    if (!derived.body) {
      logger.setFailed(
        'ai-summarize is enabled but the release body is empty. ' +
          'Write some release notes (even rough ones) and the AI will rewrite them.',
      )
      return
    }

    logger.info('Rewriting release notes with AI...')
    try {
      const res = await client.summarize({
        project_slug: inputs.project,
        release_notes: derived.body,
        version: derived.version,
      })
      title = res.summary.title
      body = res.summary.body_markdown
      entryType = res.summary.entry_type
      aiUsed = true
      logger.info(
        `AI summary ready (model: ${res.model}, usage: ${res.usage.used}/${
          res.usage.limit ?? '∞'
        } this month).`,
      )
    } catch (err) {
      logger.setFailed(`AI summarization failed: ${errorMessage(err)}`)
      return
    }
  }

  if (!body.trim()) {
    logger.setFailed(
      'Release has no body to publish. Write release notes before publishing, ' +
        'or enable ai-summarize with at least some raw notes.',
    )
    return
  }

  try {
    const entry = await client.createEntry(inputs.project, {
      title,
      body_markdown: body,
      entry_type: entryType,
      version: derived.version,
      publish: inputs.notifySubscribers,
    })

    logger.setOutput('entry-id', entry.id)
    logger.setOutput('entry-slug', entry.slug)
    logger.setOutput('entry-published', String(entry.published))
    logger.setOutput('ai-used', String(aiUsed))

    const status = entry.published ? 'published' : 'saved as draft'
    logger.info(`DeployLog entry ${status}: ${entry.title} (${entry.slug})`)
  } catch (err) {
    logger.setFailed(`Failed to create DeployLog entry: ${errorMessage(err)}`)
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
