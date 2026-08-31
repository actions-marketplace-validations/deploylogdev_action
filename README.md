# DeployLog GitHub Action

Automatically publish changelog entries from GitHub Releases. Optionally use AI to transform commit messages into user-friendly release notes.

## Quick Start

```yaml
name: Publish Changelog
on:
  release:
    types: [published]

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: deploylogdev/action@v1
        with:
          api-key: ${{ secrets.DEPLOYLOG_API_KEY }}
          project: your-project-slug
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | Yes | | Your DeployLog API key ([get one here](https://deploylog.dev/dashboard/api-keys)) |
| `project` | Yes | | Project slug from your DeployLog dashboard |
| `mode` | No | `publish` | `publish` a release as a changelog entry, or `verify` your manual against the code it cites |
| `ai-summarize` | No | `false` | Publish mode. Rewrite release notes for end users using AI |
| `notify-subscribers` | No | `false` | Publish mode. Send email digest to subscribers on publish |
| `entry-type` | No | `feature` | Publish mode. `feature`, `fix`, `improvement`, `breaking`, `announcement` |
| `fail-on` | No | `none` | Verify mode. `none`, `drift`, or `any`. See [Verifying your manual](#verifying-your-manual) |
| `github-token` | No | | Verify mode. Scopes the check to the pull request's changed files |

## Examples

### Basic: publish release notes as-is

```yaml
- uses: deploylogdev/action@v1
  with:
    api-key: ${{ secrets.DEPLOYLOG_API_KEY }}
    project: my-app
```

### AI-powered: rewrite for end users

```yaml
- uses: deploylogdev/action@v1
  with:
    api-key: ${{ secrets.DEPLOYLOG_API_KEY }}
    project: my-app
    ai-summarize: true
    notify-subscribers: true
```

### Tag as a fix

```yaml
- uses: deploylogdev/action@v1
  with:
    api-key: ${{ secrets.DEPLOYLOG_API_KEY }}
    project: my-app
    entry-type: fix
```

## Verifying your manual

Set `mode: verify` to check a DeployLog manual against the code it cites. Findings land as
annotations on the changed lines of the pull request, and the check stays green until you ask it
not to.

```yaml
name: Manual check
on: pull_request

permissions:
  contents: read
  pull-requests: read   # so the Action can read which files this pull request changes

jobs:
  manual:
    runs-on: ubuntu-latest
    steps:
      - uses: deploylogdev/action@v1
        with:
          api-key: ${{ secrets.DEPLOYLOG_API_KEY }}
          project: my-app
          mode: verify
          github-token: ${{ github.token }}
```

No `actions/checkout` step is needed. The Action does not read your working tree: it sends the
commit and the list of changed paths, and DeployLog reads the code through the GitHub App you
already connected.

### `fail-on`

| Value | The check fails when |
|-------|----------------------|
| `none` (default) | No finding fails the check. Findings are annotated and summarised, and the check stays green. |
| `drift` | A cited value moved. The manual says one thing and the code says another. |
| `any` | Also when the run could not vouch for the manual: claims it could not read, chapters with no claims, chapters with too little coverage, or claims in a repository nothing is watching. |

`fail-on` selects which **findings** fail the check. It does not make the check unfailable: if the
run cannot reach DeployLog at all (a rate limit, an expired key, an outage, a project with no
manual), it fails at every setting, `none` included. A checker that could not read the manual has
not vouched for it, and reporting green for that is the one failure this whole check exists to
prevent.

Drift and "could not vouch" are reported separately and never merged, so a broken checker cannot
read as a clean one. Start on `none`, and move up once the findings are ones you trust.

### Pull requests from forks

GitHub does not give repository secrets to a workflow triggered by a fork's pull request, so
`api-key` arrives empty and the run fails with `Input required and not supplied: api-key`. On a
public repository that means every outside contributor's first pull request shows a red check.

Until the Action handles this directly, gate the job:

```yaml
jobs:
  manual:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
```

Contributors from forks then see no check at all, which is the honest outcome: the manual is not
being verified for those changes.

### If your manual spans several repositories

A verify run proves that *this* repository runs the check, and asserts nothing about the others. So
a manual citing four repositories reports the other three as untriggered on every run, and
`fail-on: any` will fail on a manual with no drift in it until each of those repositories runs the
check too. That is the honest answer rather than a defect. Use `fail-on: drift` in the meantime.

The same applies to thin chapters. `unanchored` and `low coverage` are measured across the whole
manual, not just the files a pull request touched, so one chapter carrying no claims fails every
pull request under `fail-on: any` until you give it some. Treat `any` as a setting you switch on
once the manual is complete, not one you start with.

### Without `github-token`

The run verifies the whole manual instead of just what the pull request touched. It still works;
it is noisier, and every finding in the manual is reported on every pull request.

## Outputs

| Output | Mode | Description |
|--------|------|-------------|
| `entry-id`, `entry-slug`, `entry-published`, `ai-used` | publish | The created entry |
| `drift-count` | verify | Claims whose cited value moved. The only drift signal. |
| `error-count` | verify | Claims that could not be read at all. Not drift. |
| `unanchored-count` | verify | Chapters that declare no claims. |
| `untriggered-count` | verify | Claims in a repository nothing is watching. |
| `low-coverage-chapters` | verify | Comma-separated chapter numbers with thin claim coverage. |
| `check-failed` | verify | Whether `fail-on` escalated this run to a failure. |

## How It Works (publish mode)

1. You publish a GitHub Release
2. This Action reads the release title, tag, and body
3. If `ai-summarize` is enabled, the release body is rewritten into user-friendly language
4. A changelog entry is created on your DeployLog project
5. The entry appears on your widget, hosted changelog page, and RSS feed
6. If `notify-subscribers` is enabled, email subscribers receive a digest

## Setup

1. Sign up at [deploylog.dev](https://deploylog.dev) (free)
2. Create a project and copy the project slug
3. Generate an API key from your dashboard
4. Add the API key as a repository secret: Settings, then Secrets, then add `DEPLOYLOG_API_KEY`
5. Add the publish workflow from [Examples](#examples) to `.github/workflows/changelog.yml`

## Links

- [DeployLog](https://deploylog.dev)
- [CLI Tool](https://www.npmjs.com/package/deploylog)
- [Issues](https://github.com/deploylogdev/action/issues)

## License

MIT
